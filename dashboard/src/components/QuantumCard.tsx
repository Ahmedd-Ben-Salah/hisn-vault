import { useSnapshot } from "../data/store";
import { Icon } from "./Icon";
import { Card, Progress, Tinted } from "./ui";

/**
 * What protects the puck's signatures against a future quantum computer. Shows only what the vault reports
 * (`state.pq`): a hash-based root set on the contract, or classical-only mode.
 */
export function QuantumCard({ compact }: { compact?: boolean }) {
  const { state } = useSnapshot();
  const pq = state.pq;
  if (!pq || !pq.root) {
    return (
      <Tinted tint="wait">
        <p className="font-[800]">Quantum-safe signatures are off</p>
        <p className="mt-1 text-[15px]">This account checks the puck with ECDSA only. A large quantum computer could forge that. Deploy with the puck's hash-based key to turn it on.</p>
      </Tinted>
    );
  }
  const left = pq.capacity - pq.used;
  if (compact) {
    return (
      <p className="flex items-center gap-2 px-1 text-[14px] font-[700]">
        <Icon name="key" size={16} />
        Quantum-safe signatures on · {left} of {pq.capacity} left
      </p>
    );
  }
  return (
    <Card title="Quantum-safe signatures">
      <p className="text-[15px]">
        Every payment, second confirmation and settings change needs two signatures from your puck: the usual one, and a hash-based one that a quantum computer cannot forge. Your account checks both on the Hedera network.
      </p>
      <div className="mt-4">
        <Progress value={pq.used / pq.capacity} from={`${pq.used} used`} to={`${left} one-time keys left`} />
      </div>
      <p className="mt-3 text-[14px] text-ink-soft">
        Each key signs once. When they run low, the puck installs fresh keys through a settings change that your guardian approves.
      </p>
    </Card>
  );
}
