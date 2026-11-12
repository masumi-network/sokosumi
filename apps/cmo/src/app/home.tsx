import {
  type CmoCuso,
  type CmoOverview,
  getUsersById,
  getUsersByIdOrganizations,
  getUsersByIdSignUp,
} from "@sokosumi/core-client";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { CmoApp } from "../components/app/cmo-app";
import { CusoPicker } from "../components/cuso-picker";
import { NameSetup } from "../components/name-setup";
import { Onboarding } from "../components/onboarding";
import { OnboardingFlow } from "../components/onboarding/flow";
import { SignedIn } from "../components/signed-in";
import { getAuth } from "../lib/auth";
import { asSignedInPersonInPage } from "../lib/core";
import { LAST_CUSO_COOKIE } from "../lib/last-cuso";
import { isValidPersonName } from "../lib/person-name";
import { CMO_SIGN_IN_ERROR } from "../lib/sign-in-errors";
import { VIEW_PATHS, type View } from "../lib/views";
import { signOut } from "./actions";
import {
  addMailingList,
  answerBrandQuestion,
  answerPlanQuestion,
  applyPlanAnswers,
  approveBrandBrain,
  approveStrategy,
  connectAds,
  connectChannel,
  connectMeasurement,
  connectSetupChannel,
  finishAccounts,
  launchAd,
  loadAdCampaigns,
  loadCusos,
  loadMessages,
  loadOverview,
  loadPieceText,
  loadState,
  onboard,
  pauseEntry,
  requestStrategy,
  retryLearning,
  revertUpdate,
  saveBrandBrain,
  sendMessage,
  setAdBudget,
  setAdCampaignStatus,
  skipBrandQuestions,
  skippedSteps,
  startOver,
} from "./cmo-actions";
import { saveName } from "./name-actions";

/** A repeated query param arrives as a list; the first one counts. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Core refused the token: revoked before it expired (a password change, a ban). */
function isRefused(response: Response | undefined): boolean {
  return response?.status === 401 || response?.status === 403;
}

/** The sign-up origin Core records for an account created through CMO. */
const CMO_SIGN_UP_ORIGIN = "cmo";

/**
 * The website a CMO sign-up link carried (`/signup?url=`), to start the
 * hiring form with. Only a nicety: without it the person types it.
 */
async function signUpWebsite(
  asPerson: Awaited<ReturnType<typeof asSignedInPersonInPage>>,
): Promise<string | undefined> {
  const { data, response } = await getUsersByIdSignUp({
    ...asPerson,
    path: { id: "me" },
  });
  if (!data) {
    // Accounts from before sign-up recording have none.
    if (response?.status !== 404) {
      console.error(`Core did not read the sign-up (${response?.status})`);
    }
    return undefined;
  }
  const { origin, context } = data.data;
  return origin === CMO_SIGN_UP_ORIGIN && typeof context.url === "string"
    ? context.url
    : undefined;
}

/** The organizations the person belongs to, for the hire form's "Where". */
async function organizationsOf(
  asPerson: Awaited<ReturnType<typeof asSignedInPersonInPage>>,
): Promise<{ id: string; name: string }[]> {
  const { data, response } = await getUsersByIdOrganizations({
    ...asPerson,
    path: { id: "me" },
  });
  if (!data) {
    // Without them the form still hires into a new organization.
    console.error(`Core did not list the organizations (${response?.status})`);
    return [];
  }
  return data.data.map(({ id, name }) => ({ id, name }));
}

type OpenedScreen =
  | { kind: "cuso"; overview: CmoOverview }
  /** The only Cuso, opened by an address naming him, which the proxy remembers. */
  | { kind: "only"; projectId: string }
  | { kind: "picker"; cusos: CmoCuso[]; mayHire: boolean }
  /** `cusoPicker`: the person has a Cuso for "Your Cusos" to lead back to. */
  | { kind: "hire"; cusoPicker: boolean }
  /** In place of the hire form: Core's hire allowlist leaves the person out. */
  | { kind: "inviteOnly" };

/**
 * Which screen opens (ADR 0065): the hire form or the picker when the
 * address asks for it; else the Cuso the address names, else the one last
 * opened on this device, else the only one, else the Cuso picker, else the
 * hire form. A Project the person can't use falls through. A person Core's
 * hire allowlist leaves out sees the invite-only page for the hire form.
 */
async function openedScreen(input: {
  hire: boolean;
  pick: boolean;
  named: string | undefined;
  remembered: string | undefined;
}): Promise<OpenedScreen> {
  if (!input.hire && !input.pick) {
    const projectId = input.named ?? input.remembered;
    if (projectId) {
      const overview = await loadOverview(projectId);
      if (overview) return { kind: "cuso", overview };
    }
  }
  const { cusos, mayHire } = await loadCusos();
  const hireScreen: OpenedScreen = mayHire
    ? { kind: "hire", cusoPicker: cusos.length > 0 }
    : { kind: "inviteOnly" };
  if (input.hire) return hireScreen;
  const [newest] = cusos;
  if (!newest) return hireScreen;
  if (input.pick || input.named || cusos.length > 1) {
    return { kind: "picker", cusos, mayHire };
  }
  return { kind: "only", projectId: newest.projectId };
}

export interface HomeSearchParams {
  error?: string | string[];
  step?: string | string[];
  project?: string | string[];
  /** The account menu's "Your Cusos": the Cuso picker. */
  cusos?: string | string[];
  /** "Hire a new Cuso" and Start over: the hire form. */
  hire?: string | string[];
  connect?: string | string[];
  from?: string | string[];
}

interface HomeProps {
  searchParams: Promise<HomeSearchParams>;
  /** The app page at this address; the chat is home. */
  view: View;
}

/**
 * Every CMO page renders through here. Before onboarding ends the first run
 * owns every address.
 */
export async function Home({ searchParams, view }: HomeProps) {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  const params = await searchParams;
  const error = first(params.error);
  const step = first(params.step);
  // Signed out, the home page is the waitlist site (the proxy serves it);
  // sign-in errors and expired sessions go to the unlinked /login.
  const signedOut = (signedOutError: string | undefined): never =>
    redirect(
      signedOutError
        ? `/login?error=${encodeURIComponent(signedOutError)}`
        : "/login",
    );

  if (!session) return signedOut(error);

  const asPerson = await asSignedInPersonInPage(requestHeaders);
  // CMO's session holds only a display name, so the name step reads the parts.
  const person = await getUsersById({ ...asPerson, path: { id: "me" } });
  if (isRefused(person.response)) return signedOut(CMO_SIGN_IN_ERROR.signedOut);
  if (!person.data) {
    throw new Error(
      `Core did not read the person (${person.response?.status})`,
    );
  }

  const project = first(params.project) || undefined;
  const opened = await openedScreen({
    hire: first(params.hire) !== undefined,
    pick: first(params.cusos) !== undefined,
    named: project,
    remembered: (await cookies()).get(LAST_CUSO_COOKIE)?.value || undefined,
  }).catch(() => undefined);
  // Core unreachable: keep the signed-in shell rather than an error page.
  // An unavailable named Project falls through to the picker or the hire
  // form (ADR 0065).
  if (opened === undefined) {
    return (
      <SignedIn
        name={session.user.name}
        email={session.user.email}
        signOut={signOut}
      />
    );
  }
  if (opened.kind === "only") {
    redirect(
      `${VIEW_PATHS[view]}?project=${encodeURIComponent(opened.projectId)}`,
    );
  }
  if (opened.kind === "picker") {
    return <CusoPicker cusos={opened.cusos} mayHire={opened.mayHire} />;
  }
  if (opened.kind === "inviteOnly") {
    return (
      <SignedIn
        name={session.user.name}
        email={session.user.email}
        signOut={signOut}
        inviteOnly
      />
    );
  }
  if (opened.kind === "hire") {
    const { firstName, lastName } = person.data.data;
    if (!isValidPersonName(firstName ?? "", lastName ?? "")) {
      return <NameSetup saveName={saveName} signOut={signOut} />;
    }
    // Cuso goes into a new organization or one the person belongs to (ADR 0065).
    const [websiteUrl, organizations] = await Promise.all([
      signUpWebsite(asPerson),
      organizationsOf(asPerson),
    ]);
    return (
      <Onboarding
        websiteUrl={websiteUrl}
        organizations={organizations}
        signOut={signOut}
        cusoPicker={opened.cusoPicker}
        onboard={onboard}
      />
    );
  }
  const { overview } = opened;
  // Core ends hiring on the first connection; back from a connection made
  // during hiring (Accounts, or Results' measurement), the founder stays in
  // it until Continue.
  const backInHiring =
    (step === "connect" || step === "results") &&
    first(params.from) === "onboarding" &&
    overview.strategyVersion?.approvedAt != null;
  // Every Cuso action names the Project of the overview this page rendered,
  // so a workspace switch elsewhere cannot move them to another Cuso.
  const { projectId } = overview;
  if (overview.onboardingStep !== "done" || backInHiring) {
    // The app's pages open once onboarding ends; until then it is the first run.
    if (view !== "chat") {
      redirect(`/?project=${encodeURIComponent(projectId)}`);
    }
    return (
      <OnboardingFlow
        overview={overview}
        messages={await loadMessages(projectId).catch(() => [])}
        initialStep={step === "results" ? "results" : undefined}
        skipped={await skippedSteps(overview.projectId)}
        actions={{
          loadState: loadState.bind(null, projectId),
          sendMessage: sendMessage.bind(null, projectId),
          retryLearning: retryLearning.bind(null, projectId),
          requestStrategy: requestStrategy.bind(null, projectId),
          saveBrandBrain: saveBrandBrain.bind(null, projectId),
          approveStrategy: approveStrategy.bind(null, projectId),
          setAdBudget: setAdBudget.bind(null, projectId),
          approveBrandBrain: approveBrandBrain.bind(null, projectId),
          answerBrandQuestion: answerBrandQuestion.bind(null, projectId),
          answerPlanQuestion: answerPlanQuestion.bind(null, projectId),
          applyPlanAnswers: applyPlanAnswers.bind(null, projectId),
          skipBrandQuestions: skipBrandQuestions.bind(null, projectId),
          finishAccounts: finishAccounts.bind(null, projectId),
          connectChannel: connectSetupChannel.bind(null, projectId),
          connectMeasurement: connectMeasurement.bind(null, projectId),
          connectAds: connectAds.bind(null, projectId),
          startOver: startOver.bind(null, projectId),
          signOut,
        }}
      />
    );
  }
  return (
    <CmoApp
      overview={overview}
      messages={await loadMessages(projectId).catch(() => [])}
      name={session.user.name}
      email={session.user.email}
      initialView={step === "connect" ? "channels" : view}
      connectFailed={step === "connect" && first(params.connect) === "failed"}
      actions={{
        loadState: loadState.bind(null, projectId),
        sendMessage: sendMessage.bind(null, projectId),
        loadPieceText: loadPieceText.bind(null, projectId),
        approveStrategy: approveStrategy.bind(null, projectId),
        setAdBudget: setAdBudget.bind(null, projectId),
        revertUpdate: revertUpdate.bind(null, projectId),
        retryLearning: retryLearning.bind(null, projectId),
        saveBrandBrain: saveBrandBrain.bind(null, projectId),
        pauseEntry: pauseEntry.bind(null, projectId),
        connectChannel: connectChannel.bind(null, projectId),
        addMailingList: addMailingList.bind(null, projectId),
        connectMeasurement: connectMeasurement.bind(null, projectId),
        connectAds: connectAds.bind(null, projectId),
        launchAd: launchAd.bind(null, projectId),
        setAdCampaignStatus: setAdCampaignStatus.bind(null, projectId),
        loadAdCampaigns: loadAdCampaigns.bind(null, projectId),
        startOver: startOver.bind(null, projectId),
        signOut,
      }}
    />
  );
}
