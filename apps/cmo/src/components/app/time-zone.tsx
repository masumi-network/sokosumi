"use client";

import { useEffect, useState, useTransition } from "react";
import { AGENT_NAME } from "../../lib/agent";

export type SetTimeZone = (timeZone: string) => Promise<string | null>;

/** "America/Los_Angeles" as people read it. */
export function timeZoneLabel(timeZone: string): string {
  return timeZone.replaceAll("_", " ");
}

function supportedTimeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}

interface TimeZoneSettingProps {
  timeZone: string;
  setTimeZone: SetTimeZone;
}

/**
 * The time zone Cuso's routines run in. Offers this browser's zone in one
 * tap when it differs, and every other zone behind Change.
 */
export function TimeZoneSetting({
  timeZone,
  setTimeZone,
}: TimeZoneSettingProps) {
  // Read after mount: the server does not know the browser's zone.
  const [here, setHere] = useState<string | null>(null);
  useEffect(() => {
    setHere(Intl.DateTimeFormat().resolvedOptions().timeZone ?? null);
  }, []);
  const [choosing, setChoosing] = useState(false);
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const save = (next: string) =>
    startSaving(async () => {
      setError(await setTimeZone(next));
      setChoosing(false);
    });
  const zones = choosing ? supportedTimeZones() : [];

  return (
    <div className="li time-zone">
      <span className="grow">
        <b>Time zone</b>
        <br />
        <span className="note">
          {AGENT_NAME} works on {timeZoneLabel(timeZone)} time.
        </span>
      </span>
      <span className="time-zone-actions">
        {choosing ? (
          <select
            aria-label="Time zone"
            defaultValue={timeZone}
            disabled={saving}
            onChange={(event) => save(event.target.value)}
          >
            {(zones.includes(timeZone) ? zones : [timeZone, ...zones]).map(
              (zone) => (
                <option key={zone} value={zone}>
                  {timeZoneLabel(zone)}
                </option>
              ),
            )}
          </select>
        ) : (
          <>
            {here && here !== timeZone ? (
              <button
                type="button"
                className="button button-secondary button-small"
                disabled={saving}
                onClick={() => save(here)}
              >
                Use {timeZoneLabel(here)}
              </button>
            ) : null}
            <button
              type="button"
              className="button button-ghost button-small"
              disabled={saving}
              onClick={() => setChoosing(true)}
            >
              Change
            </button>
          </>
        )}
      </span>
      {error ? (
        <p className="note" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
