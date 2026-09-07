export function missionApi() {
  const api = window.missionControl;
  if (!api || typeof api.request !== "function" || typeof api.subscribe !== "function") {
    throw new Error("Groundstation bridge is unavailable");
  }
  return {
    subscribe: (callback, filter) => api.subscribe(callback, filter),
    request: async (method, params = {}) => {
      const response = await api.request(method, params);
      if (response?.ok === false) {
        const error = new Error(response.error?.message || "Groundstation request failed");
        error.code = response.error?.code || "REQUEST_FAILED";
        throw error;
      }
      return response && Object.hasOwn(response, "result") ? response.result : response;
    }
  };
}

export async function confirmedRequest(method, params = {}) {
  const targetParams = { ...params };
  delete targetParams.confirmation;
  const confirmation = await missionApi().request("confirmation.request", { targetMethod: method, targetParams });
  if (!confirmation?.token) throw new Error("Engine did not issue a confirmation token");
  return missionApi().request(method, { ...targetParams, confirmation: confirmation.token });
}

export function notificationType(notification) {
  return notification?.type || notification?.kind || notification?.channel || "";
}

export function notificationPayload(notification) {
  return notification?.payload && typeof notification.payload === "object"
    ? notification.payload
    : notification;
}

export function engineEventFrom(notification) {
  const payload = notificationPayload(notification);
  if (notificationType(notification) !== "engine:event") return null;
  return payload.event || notification.event || payload;
}

export function streamIdentifier(value) {
  return value?.streamId || value?.generation || value?.terminalId || null;
}
