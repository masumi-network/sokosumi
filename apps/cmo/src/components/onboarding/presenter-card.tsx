"use client";

import { Loader2 } from "lucide-react";
import { useId, useRef, useState, useTransition } from "react";

const MAX_SIDE = 1600;
const PHOTO_TYPES = "image/jpeg,image/png,image/webp,image/heic";

/** The photo as a base64 JPEG no larger than MAX_SIDE, so the upload stays small. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.88),
  );
  if (!blob) throw new Error("Could not read the photo");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

interface PresenterCardProps {
  /** The owner already gave a photo with consent. */
  initiallySet: boolean;
  onSet: (photo: string) => Promise<{ error: string | null }>;
  onClear: () => Promise<{ error: string | null }>;
}

/**
 * Offers the owner to front the talking videos with a selfie. Optional:
 * without one, a generated presenter speaks. The consent comes first, and
 * Core stores it with the photo.
 */
export function PresenterCard({
  initiallySet,
  onSet,
  onClear,
}: PresenterCardProps) {
  const consentId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [set, setSet] = useState(initiallySet);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function upload(file: File) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await onSet(await shrink(file));
        if (result.error) {
          setError(result.error);
          return;
        }
        setSet(true);
      } catch {
        setError("Choose a JPEG, PNG or WebP photo.");
      }
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await onClear();
      if (result.error) {
        setError(result.error);
        return;
      }
      setSet(false);
      setConsent(false);
    });
  }

  return (
    <div className="card ob-presenter">
      <p className="ob-network-name">Want to be the face of your videos?</p>
      {set ? (
        <>
          <p className="ob-small muted">
            You front my talking videos. Remove the photo any time.
          </p>
          <button
            type="button"
            className="button button-ghost button-small"
            disabled={pending}
            onClick={remove}
          >
            Remove my photo
          </button>
        </>
      ) : (
        <>
          <p className="ob-small muted">
            Add a selfie, facing the camera, and I put you in your talking
            videos. Without one, a generated presenter speaks.
          </p>
          <label className="ob-presenter-consent" htmlFor={consentId}>
            <input
              id={consentId}
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            I am the person in this photo, or I may use it in videos.
          </label>
          <input
            ref={input}
            type="file"
            accept={PHOTO_TYPES}
            aria-label="Your photo"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) upload(file);
            }}
          />
          <button
            type="button"
            className="button button-secondary button-small"
            disabled={!consent || pending}
            onClick={() => input.current?.click()}
          >
            {pending ? (
              <Loader2 size={14} className="spin" aria-hidden="true" />
            ) : null}
            Add a selfie
          </button>
        </>
      )}
      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
