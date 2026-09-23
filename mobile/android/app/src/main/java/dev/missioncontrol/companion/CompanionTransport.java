package dev.missioncontrol.companion;

import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.spec.X509EncodedKeySpec;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

final class CompanionTransport {
  static final int API_VERSION = 1;
  static final String INVITE = "/mobile/v1/invite", PAIR = "/mobile/v1/pair", REQUEST = "/mobile/v1/request";
  private static final SecureRandom RANDOM = new SecureRandom();

  static String base64Url(byte[] value) { return Base64.encodeToString(value, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP); }
  static byte[] fromBase64Url(String value) { return Base64.decode(value, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP); }
  static String endpoint(String value) { String clean = value.trim().replaceAll("/+$", ""); if (!clean.matches("http://(?:10\\.|192\\.168\\.|172\\.(?:1[6-9]|2[0-9]|3[01])\\.)[^/]+")) throw new IllegalArgumentException("Use the private-LAN endpoint shown by OUTARCH"); return clean; }

  static JSONObject pair(String endpointValue, String code, String deviceName) throws Exception {
    String endpoint = endpoint(endpointValue);
    if (!code.matches("\\d{6}")) throw new IllegalArgumentException("Pairing code must contain six digits");
    JSONObject invite = get(endpoint + INVITE);
    KeyPairGenerator generator = KeyPairGenerator.getInstance("X25519"); KeyPair client = generator.generateKeyPair();
    String clientPublicKey = base64Url(client.getPublic().getEncoded());
    String message = invite.getString("pairingId") + "|" + invite.getString("nonce") + "|" + deviceName.trim() + "|" + clientPublicKey;
    Mac proofMac = Mac.getInstance("HmacSHA256"); proofMac.init(new SecretKeySpec(code.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    JSONObject request = new JSONObject().put("pairingId", invite.getString("pairingId")).put("deviceName", deviceName.trim()).put("clientPublicKey", clientPublicKey).put("proof", base64Url(proofMac.doFinal(message.getBytes(StandardCharsets.UTF_8))));
    JSONObject response = post(endpoint + PAIR, request, null);
    PublicKey server = KeyFactory.getInstance("X25519").generatePublic(new X509EncodedKeySpec(fromBase64Url(invite.getString("serverPublicKey"))));
    KeyAgreement agreement = KeyAgreement.getInstance("X25519"); agreement.init(client.getPrivate()); agreement.doPhase(server, true);
    byte[] pairingKey = hkdf(agreement.generateSecret(), fromBase64Url(invite.getString("nonce")), "mission-control-mobile-pairing-v1".getBytes(StandardCharsets.UTF_8), 32);
    JSONObject credential = decrypt(pairingKey, response.getJSONObject("envelope"), invite.getString("pairingId"));
    return credential.put("endpoint", endpoint);
  }

  static JSONObject request(JSONObject credential, String operation) throws Exception {
    String endpoint = endpoint(credential.getString("endpoint")); String deviceId = credential.getString("deviceId"); byte[] secret = fromBase64Url(credential.getString("secret"));
    long timestamp = System.currentTimeMillis(); String nonce = UUID.randomUUID().toString();
    String aad = API_VERSION + "|" + REQUEST + "|" + deviceId + "|" + timestamp + "|" + nonce;
    JSONObject envelope = encrypt(secret, new JSONObject().put("operation", operation), aad);
    JSONObject headers = new JSONObject().put("X-Mission-Control-Device", deviceId).put("X-Mission-Control-Time", String.valueOf(timestamp)).put("X-Mission-Control-Nonce", nonce);
    JSONObject sealed = post(endpoint + REQUEST, envelope, headers);
    JSONObject opened = decrypt(secret, sealed, aad + "|response");
    if (!opened.optBoolean("ok", false)) throw new IllegalStateException(opened.optString("error", "OUTARCH rejected the request"));
    return opened.getJSONObject("result");
  }

  private static byte[] hkdf(byte[] ikm, byte[] salt, byte[] info, int length) throws Exception {
    Mac mac = Mac.getInstance("HmacSHA256"); mac.init(new SecretKeySpec(salt, "HmacSHA256")); byte[] prk = mac.doFinal(ikm);
    mac.init(new SecretKeySpec(prk, "HmacSHA256")); mac.update(info); mac.update((byte) 1); byte[] block = mac.doFinal(); byte[] out = new byte[length]; System.arraycopy(block, 0, out, 0, length); return out;
  }
  private static JSONObject encrypt(byte[] key, JSONObject value, String aad) throws Exception {
    byte[] iv = new byte[12]; RANDOM.nextBytes(iv); Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv)); cipher.updateAAD(aad.getBytes(StandardCharsets.UTF_8)); byte[] combined = cipher.doFinal(value.toString().getBytes(StandardCharsets.UTF_8));
    byte[] ciphertext = new byte[combined.length - 16], tag = new byte[16]; System.arraycopy(combined, 0, ciphertext, 0, ciphertext.length); System.arraycopy(combined, ciphertext.length, tag, 0, 16);
    return new JSONObject().put("version", API_VERSION).put("iv", base64Url(iv)).put("ciphertext", base64Url(ciphertext)).put("tag", base64Url(tag));
  }
  private static JSONObject decrypt(byte[] key, JSONObject envelope, String aad) throws Exception {
    byte[] ciphertext = fromBase64Url(envelope.getString("ciphertext")), tag = fromBase64Url(envelope.getString("tag")); byte[] combined = new byte[ciphertext.length + tag.length]; System.arraycopy(ciphertext, 0, combined, 0, ciphertext.length); System.arraycopy(tag, 0, combined, ciphertext.length, tag.length);
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, fromBase64Url(envelope.getString("iv")))); cipher.updateAAD(aad.getBytes(StandardCharsets.UTF_8)); return new JSONObject(new String(cipher.doFinal(combined), StandardCharsets.UTF_8));
  }
  private static JSONObject get(String url) throws Exception { return exchange("GET", url, null, null); }
  private static JSONObject post(String url, JSONObject body, JSONObject headers) throws Exception { return exchange("POST", url, body, headers); }
  private static JSONObject exchange(String method, String target, JSONObject body, JSONObject headers) throws Exception {
    HttpURLConnection connection = (HttpURLConnection) new URL(target).openConnection(); connection.setRequestMethod(method); connection.setConnectTimeout(8000); connection.setReadTimeout(12000); connection.setRequestProperty("Accept", "application/json");
    if (headers != null) for (java.util.Iterator<String> keys = headers.keys(); keys.hasNext();) { String key = keys.next(); connection.setRequestProperty(key, headers.getString(key)); }
    if (body != null) { connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json"); try (OutputStream output = connection.getOutputStream()) { output.write(body.toString().getBytes(StandardCharsets.UTF_8)); } }
    int statusCode = connection.getResponseCode(); InputStream stream = statusCode < 400 ? connection.getInputStream() : connection.getErrorStream(); if (stream == null) throw new IllegalStateException("OUTARCH request failed (HTTP " + statusCode + ")"); StringBuilder value = new StringBuilder(); try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) { String line; while ((line = reader.readLine()) != null && value.length() < 262144) value.append(line); }
    JSONObject result = new JSONObject(value.toString()); if (connection.getResponseCode() >= 400) throw new IllegalStateException(result.optString("error", "OUTARCH request failed")); return result;
  }
}
