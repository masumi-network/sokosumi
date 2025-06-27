"use server";

export async function signInSocial(
  _provider: "google" | "microsoft" | "apple" | "linkedin",
): Promise<{ success: boolean; error?: string }> {
  try {
    return { success: false };
    //as it is unuesed for now we will just fail
    /*
    await auth.api.signInSocial({
      body: {
        provider: provider,
      },
    });

    return { success: true };*/
  } catch {
    return { success: false };
  }
}
