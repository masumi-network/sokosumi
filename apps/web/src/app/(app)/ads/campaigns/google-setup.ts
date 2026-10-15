import { settleAdsLoad } from "@/app/ads/components/ads-load-error";
import { toGoogleTargeting } from "@/lib/ads/targeting";
import { adsService } from "@/lib/services/ads.service";

/**
 * What the Google form needs from Core before it shows: whether the project
 * has a Market profile (which "Add from Market" needs; only the profile is
 * read here, since keywords can cost a data-provider request and load on the
 * button's click), Google's languages, and the profile's country and language
 * as the form's starting targeting. A failed lookup hides its part (the
 * button, the language picker, a prefilled chip), never the form.
 */
export async function loadGoogleSetup(projectId: string, accountId: string) {
  const profileLoad = settleAdsLoad(adsService.getMarketProfile(projectId));
  const languagesLoad = settleAdsLoad(
    adsService.listLanguages(projectId, accountId),
  );
  // The location needs only the profile, so it does not wait for the languages.
  const locationLoad = profileLoad.then((profileResult) => {
    const locationId = profileResult.isOk()
      ? profileResult.value.profile?.locationId
      : undefined;
    return locationId
      ? settleAdsLoad(
          adsService.getLocationById(projectId, accountId, locationId),
        )
      : null;
  });

  const [profileResult, languagesResult, locationResult] = await Promise.all([
    profileLoad,
    languagesLoad,
    locationLoad,
  ]);
  const profile = profileResult.isOk() ? profileResult.value.profile : null;
  return {
    hasMarketProfile: !!profile,
    targeting: toGoogleTargeting({
      profile,
      languages: languagesResult.isOk()
        ? languagesResult.value.languages
        : null,
      locations: locationResult?.isOk() ? locationResult.value.locations : [],
    }),
  };
}
