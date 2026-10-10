import { OWNER } from "../../state/accounts";
import { useSnapshot } from "../../state/session";
import { Empty, Screen, T, Title } from "../../ui/kit";
import { AccountBar, PaymentRow } from "../../ui/parts";
import { C } from "../../ui/theme";

export default function Activity() {
  const { payments, state, now } = useSnapshot();
  return (
    <Screen header={<AccountBar />}>
      <Title sub={`Everything ${OWNER.name}'s account has done. You can see it; you can never move it.`}>Activity</Title>
      {payments.length === 0 ? <Empty title="Nothing here yet." /> : payments.map((p) => <PaymentRow key={p.id} p={p} state={state} now={now} />)}
      <T size={13} color={C.muted} style={{ marginTop: 16 }}>
        Every step is recorded on the Hedera network.
      </T>
    </Screen>
  );
}
