import { useState, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { StatusChip } from "../components/Status";
import { PageTitle, Panel, Section } from "../components/ui";
import { useSnapshot } from "../data/store";
import { dateTime, duration } from "../lib/format";
import { useNames } from "../lib/people";
import type { IconName } from "../lib/phase";

function NameEditor({ address }: { address: string }) {
  const { state } = useSnapshot();
  const { nameOf, setName, names } = useNames();
  const [editing, setEditing] = useState(false);
  const current = names[address.toLowerCase()] ?? "";
  if (!editing) {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-2">
        <span className="text-lg font-[700]">{nameOf(address, state)}</span>
        <button type="button" className="text-sm font-[700] text-door hover:underline" onClick={() => setEditing(true)}>
          Rename
        </button>
      </span>
    );
  }
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const v = new FormData(e.currentTarget).get("name");
        setName(address, String(v ?? ""));
        setEditing(false);
      }}
    >
      <input name="name" defaultValue={current || nameOf(address, state)} autoFocus className="rounded-md border-2 border-door bg-paper px-2 py-1 font-[700]" aria-label="Name" />
      <button type="submit" className="rounded-md bg-door px-3 font-[700] text-paper">
        Save
      </button>
    </form>
  );
}

function KeyRow({ address, icon, can, never, online }: { address: string; icon: IconName; can: string; never: string; online?: boolean }) {
  return (
    <li className="grid gap-3 px-5 py-4 md:grid-cols-[2.5rem_1fr_1fr]">
      <Icon name={icon} size={26} className="text-ink-soft md:mt-1" />
      <div className="min-w-0">
        <NameEditor address={address} />
        <p className="font-mono text-sm break-all text-ink-soft">{address}</p>
        {online !== undefined && (
          <p className="mt-1">
            {online ? <StatusChip tone="safe" icon="check" word="Online" size="sm" /> : <StatusChip tone="quiet" icon="wifi-off" word="Offline" size="sm" />}
          </p>
        )}
      </div>
      <div className="text-sm leading-relaxed">
        <p>
          <strong className="text-safe">Can:</strong> {can}
        </p>
        <p className="mt-1">
          <strong className="text-stop">Never:</strong> {never}
        </p>
      </div>
    </li>
  );
}

function Group({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <Section title={title}>
      {lead && <p className="mb-3 max-w-[70ch] text-ink-soft">{lead}</p>}
      <Panel>
        <ul className="divide-y divide-line">{children}</ul>
      </Panel>
    </Section>
  );
}

export function People() {
  const { state, now } = useSnapshot();
  const online = (address: string) => state.devices.find((d) => d.address.toLowerCase() === address.toLowerCase())?.online;
  return (
    <div>
      <PageTitle title="People" lead="Who holds a key, and what each key can and can never do. The vault checks every one of these rules itself." />
      <p className="-mt-4 mb-2 text-sm text-ink-soft">Names you type here are kept on this computer only. The vault only knows addresses.</p>

      <Group title="Owner">
        <KeyRow address={state.puck} icon="key" can="Sign payments after reading them on its own screen, confirm them again, cancel, freeze, propose rule changes." never="Skip the wait or the guardian." online={online(state.puck)} />
      </Group>

      <Group
        title="Guardians"
        lead={
          state.guardians.length < 2 ? (
            <span className="font-[700] text-hold">Only one guardian. Replacing a lost puck needs two different guardians, so add a second one.</span>
          ) : (
            "Trusted people with the guardian page on their phone. Two different guardians are needed to replace a lost puck."
          )
        }
      >
        {state.guardians.map((g) => (
          <KeyRow
            key={g}
            address={g}
            icon="person"
            can="Stop a payment, approve a large one after calling the owner, freeze, approve or stop a rule change, help replace a lost puck."
            never="Pay, receive money from the vault, or replace the puck alone."
            online={online(g)}
          />
        ))}
      </Group>

      <Group title="Alarm lights" lead="Small devices that beep and light up when a payment waits. Anyone nearby can press stop.">
        {state.watchers.length === 0 ? (
          <li className="px-5 py-4 text-ink-soft">No alarm light set up.</li>
        ) : (
          state.watchers.map((w) => (
            <KeyRow key={w} address={w} icon="warn" can="Stop a payment, stop a rule change, freeze." never="Approve anything, pay, or take part in a recovery." online={online(w)} />
          ))
        )}
      </Group>

      <Group title="Helper">
        {state.agent ? (
          <KeyRow address={state.agent} icon="chat" can="Pay small bills to saved names, inside its allowance." never="Pay anyone new, approve, stop, change rules or raise its own limit." />
        ) : (
          <li className="px-5 py-4 text-ink-soft">No helper is set up.</li>
        )}
      </Group>

      <Section title="Saved names">
        <p className="mb-3 max-w-[70ch] text-ink-soft">
          Small payments to these go at once. A saved name is a label you chose, not a check of who they are. Saving a new one takes {duration(state.immutables.settingsDelay)} and a guardian's yes.
        </p>
        <Panel>
          <ul className="divide-y divide-line">
            {state.payees.map((p) => {
              const onProbation = now - p.since < state.immutables.probation;
              return (
                <li key={p.address} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-[700]">{p.label ?? "No label"}</p>
                    <p className="font-mono text-sm break-all text-ink-soft">{p.address}</p>
                  </div>
                  <p className="text-sm text-ink-soft">Saved {dateTime(p.since)}</p>
                  {onProbation ? (
                    <StatusChip tone="hold" icon="hourglass" word={`Instant from ${dateTime(p.since + state.immutables.probation)}`} size="sm" />
                  ) : (
                    <StatusChip tone="safe" icon="bolt" word="Can be paid at once" size="sm" />
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      </Section>
    </div>
  );
}
