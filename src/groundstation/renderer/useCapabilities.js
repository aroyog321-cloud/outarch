import React from "react";
import { missionApi } from "./missionApi.js";

export default function useCapabilities() {
  const [capabilities, setCapabilities] = React.useState(null);
  const [status, setStatus] = React.useState("loading");
  const [error, setError] = React.useState("");
  const mounted = React.useRef(true);

  const refresh = React.useCallback(async () => {
    setStatus("loading");
    try {
      const hello = await missionApi().request("system.hello");
      if (!hello?.capabilities || typeof hello.capabilities !== "object") {
        throw new Error("Protocol capability handshake did not return a capability map");
      }
      if (mounted.current) {
        setCapabilities(hello.capabilities);
        setError("");
        setStatus("ready");
      }
      return hello.capabilities;
    } catch (value) {
      if (mounted.current) {
        setError(value instanceof Error ? value.message : String(value));
        setStatus("error");
      }
      return null;
    }
  }, []);

  React.useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; };
  }, [refresh]);

  return { capabilities, status, error, refresh };
}
