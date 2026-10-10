import { useEffect, useState } from "react";
import { useSource } from "../data/store";
import { Button } from "./ui";

/**
 * Stop asks for one confirmation in place ("Yes, stop it" for 5 seconds), then the owner signs the stop on the puck.
 * The relayer pushes the request to the puck (POST /payments/:id/stop-request); the puck shows the payment and asks for the PIN.
 */
export function StopPayment({ paymentId, full, size = "lg" }: { paymentId: number; full?: boolean; size?: "md" | "lg" }) {
  const source = useSource();
  const [failed, setFailed] = useState(false);
  const [armed, setArmed] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  if (sent && failed) {
    return (
      <p className="text-[15px] font-[700] text-stop-text" role="alert">
        Your puck is not connected. Press Stop on your puck. Stopping is always safe.
      </p>
    );
  }
  if (sent) {
    return (
      <p className="text-[15px] font-[700] text-stop-text" role="status">
        Check your puck and enter your PIN to stop it. The money stays in your account.
      </p>
    );
  }
  return (
    <Button
      look="stop"
      icon="hand"
      size={size}
      className={full ? "w-full" : ""}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        setSent(true);
        setFailed(false);
        source.requestStop(paymentId).catch(() => setFailed(true));
      }}
    >
      {armed ? "Yes, stop it" : "Stop payment"}
    </Button>
  );
}
