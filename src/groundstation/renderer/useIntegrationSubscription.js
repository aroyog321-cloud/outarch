import React from "react";
import { missionApi } from "./missionApi.js";

/**
 * T195 - Consolidates duplicated integration event subscription and cleanup
 * logic across MCP, Mobile Companion, Plugin Platform, and overview surfaces.
 * Uses typed preload boundary filters to avoid receiving unneeded traffic.
 */
export default function useIntegrationSubscription(integrationName, onEvent) {
  const handlerRef = React.useRef(onEvent);
  handlerRef.current = onEvent;

  React.useEffect(() => {
    let active = true;
    let unsubscribe = () => {};

    try {
      unsubscribe = missionApi().subscribe(notification => {
        if (!active) return;
        if (notification?.type === "integration:event" && (!integrationName || notification.integration === integrationName)) {
          handlerRef.current?.(notification);
        }
      }, { type: "integration:event", integration: integrationName });
    } catch (error) {
      // Integration subscription is progressive; explicit polling/refresh remains available
    }

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [integrationName]);
}
