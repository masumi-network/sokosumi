import { AccountChoices } from "../../../components/account-choices";
import { FixtureFrame, previewOnly } from "../fixture-frame";

async function choose() {
  "use server";
}

/** The account picker over fixture data. Local and preview deploys only. */
export default function ConnectChoosePage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string | string[] }>;
}) {
  previewOnly();
  return (
    <FixtureFrame searchParams={searchParams}>
      <AccountChoices
        choose={choose}
        choices={[
          {
            externalAccountId: "member-1",
            name: "Alice Doe",
            handle: null,
            kind: "profile",
          },
          {
            externalAccountId: "urn:li:organization:42",
            name: "Acme Rockets",
            handle: "acme-rockets",
            kind: "page",
          },
          {
            externalAccountId: "urn:li:organization:43",
            name: "Acme Rockets Careers, Europe, Middle East and Africa",
            handle: "acme-careers",
            kind: "page",
          },
        ]}
      />
    </FixtureFrame>
  );
}
