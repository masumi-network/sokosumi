import { Status } from "@prisma/client";

export enum StatusDTO {
  Online = "Online",
  Offline = "Offline",
  Deregistered = "Deregistered",
  Invalid = "Invalid",
}

export function createStatusDTO(status: Status): StatusDTO {
  switch (status) {
    case Status.Online:
      return StatusDTO.Online;
    case Status.Offline:
      return StatusDTO.Offline;
    case Status.Deregistered:
      return StatusDTO.Deregistered;
    case Status.Invalid:
      return StatusDTO.Invalid;
  }
}

export function createStatusDTOs(statuses: Status[]): StatusDTO[] {
  return statuses.map(createStatusDTO);
}
