package dev.missioncontrol.companion;

import android.app.Activity;
import android.app.BiometricPrompt;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONObject;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
  private final ExecutorService work = Executors.newSingleThreadExecutor();
  private SecureCredentialStore credentials; private TextView status, output; private EditText endpoint, code, name;
  @Override public void onCreate(Bundle state) { super.onCreate(state); credentials = new SecureCredentialStore(this); render(); }
  @Override public void onDestroy() { work.shutdownNow(); super.onDestroy(); }

  private TextView text(String value, int size) { TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(0xffd8ded9); view.setPadding(0, 8, 0, 8); return view; }
  private EditText input(String hint) { EditText view = new EditText(this); view.setHint(hint); view.setTextColor(0xffe2e7e3); view.setHintTextColor(0xff747d76); view.setSingleLine(true); return view; }
  private Button button(String label, View.OnClickListener listener) { Button view = new Button(this); view.setText(label); view.setOnClickListener(listener); return view; }
  private void render() {
    ScrollView scroll = new ScrollView(this); scroll.setBackgroundColor(0xff0d0f0e); LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(28, 36, 28, 36); scroll.addView(root);
    TextView title = text("OUTARCH", 12); title.setLetterSpacing(.18f); root.addView(title); root.addView(text("Supervise your development system", 24)); root.addView(text("Bounded project health and approvals. No remote shell, terminal input, or source-code access.", 13));
    status = text("Not paired", 13); status.setPadding(0, 18, 0, 12); root.addView(status);
    endpoint = input("Desktop endpoint · http://192.168.x.x:37422"); root.addView(endpoint); code = input("Six-digit pairing code"); code.setInputType(InputType.TYPE_CLASS_NUMBER); root.addView(code); name = input("Device name"); name.setText(android.os.Build.MODEL); root.addView(name);
    root.addView(button("Pair securely", view -> pair()));
    LinearLayout actions = new LinearLayout(this); actions.setOrientation(LinearLayout.HORIZONTAL); actions.setGravity(Gravity.CENTER); actions.addView(button("Summary", view -> read("snapshot"))); actions.addView(button("Needs You", view -> read("needs"))); actions.addView(button("Memory", view -> read("memory"))); root.addView(actions);
    root.addView(button("Verify identity for a sensitive approval", view -> biometric())); root.addView(button("Forget this desktop", view -> { credentials.clear(); status.setText("Credential removed from this phone"); output.setText(""); }));
    output = text("Pair on the same private network to begin.", 12); output.setTextIsSelectable(true); output.setPadding(0, 18, 0, 60); root.addView(output); setContentView(scroll);
    try { if (credentials.load() != null) status.setText("Paired credential protected by Android Keystore"); } catch (Exception error) { status.setText("Secure credential needs repair"); }
  }
  private void pair() { status.setText("Proving pairing code and exchanging keys…"); work.execute(() -> { try { JSONObject value = CompanionTransport.pair(endpoint.getText().toString(), code.getText().toString(), name.getText().toString()); credentials.save(value.toString()); runOnUiThread(() -> { status.setText("Paired · credential protected by Android Keystore"); code.setText(""); output.setText("Encrypted supervision is ready."); }); } catch (Exception error) { showError(error); } }); }
  private void read(String operation) { status.setText("Reading bounded " + operation + "…"); work.execute(() -> { try { String stored = credentials.load(); if (stored == null) throw new IllegalStateException("Pair this phone first"); JSONObject result = CompanionTransport.request(new JSONObject(stored), operation); runOnUiThread(() -> { status.setText("Encrypted response verified"); output.setText(result.toString(2)); }); } catch (Exception error) { showError(error); } }); }
  private void biometric() { BiometricPrompt prompt = new BiometricPrompt.Builder(this).setTitle("OUTARCH approval").setSubtitle("Confirm your identity before reviewing a sensitive request").setNegativeButton("Cancel", getMainExecutor(), (dialog, which) -> {}).build(); prompt.authenticate(new CancellationSignal(), getMainExecutor(), new BiometricPrompt.AuthenticationCallback() { @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) { status.setText("Identity verified for this review"); } @Override public void onAuthenticationError(int code, CharSequence message) { status.setText(message); } }); }
  private void showError(Exception error) { runOnUiThread(() -> { status.setText("Request did not complete"); output.setText(error.getMessage()); }); }
}
