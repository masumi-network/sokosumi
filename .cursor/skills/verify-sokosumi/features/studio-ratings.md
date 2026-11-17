# Studio ad ratings

Thumbs up or down on a generated ad, with optional reasons and a comment. Ratings feed the ad evals.

## Sub-features

- `rating-thumb`: group **Rate ad** with **Thumbs up** / **Thumbs down** (`aria-pressed` shows the saved choice).
- `rating-reasons`: **Reasons (optional)**: **Off-brand**, **Bad text**, **Wrong product**, **Ugly**, **Great**; **Comment (optional)**.
- `rating-sort-hide`: **Sort ads** (**Newest** / **Best first**) and **More ad actions** → **Hide ad**.

## How to get to it (user POV)

- Open a project in Content Studio, open a generated ad, use the rating row under it.

## Driving it with drive.mjs

- Needs a project with at least one generated ad. Click **Thumbs up**, pick a reason, then reload: `aria-pressed=true` must survive the reload (a toast alone is not proof). **Failed to save rating. Try again.** is a failure.

## Gotchas

- The fast-path local stack has no generated ads, so this journey reports "precondition missing: no ads" there. Do not insert ads through the DB to make it pass.
