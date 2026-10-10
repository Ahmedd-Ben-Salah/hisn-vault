import { ButtonLink, Empty } from "../components/ui";

export function NotFound() {
  return (
    <Empty icon="gate" title="This page does not exist">
      <ButtonLink to="/" look="quiet" className="mt-2 -ml-4">
        Go to Home
      </ButtonLink>
    </Empty>
  );
}
