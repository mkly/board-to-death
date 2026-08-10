import { addMinutes } from "date-fns";

export interface AgendaProposalBounds {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface AgendaProposalRoom {
  readonly id: string;
  readonly name: string;
}

export interface AgendaProposalSession {
  readonly id: string;
  readonly title: string;
  readonly durationMinutes: number;
  readonly parentSessionId: string | null;
  readonly trackIds: readonly string[];
  readonly speakerIds: readonly string[];
}

export interface AgendaProposalPlacement {
  readonly sessionId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly roomId: string;
  readonly trackIds: readonly string[];
  readonly speakerIds: readonly string[];
}

export interface AgendaScheduleProposal extends AgendaProposalPlacement {
  readonly title: string;
  readonly roomName: string;
  readonly durationMinutes: number;
}

export interface UnplacedAgendaSession {
  readonly sessionId: string;
  readonly title: string;
  readonly reason: string;
}

export interface AgendaProposalPlan {
  readonly proposals: readonly AgendaScheduleProposal[];
  readonly unplaced: readonly UnplacedAgendaSession[];
}

const PROPOSAL_INCREMENT_MINUTES = 15;

function overlaps(
  left: Pick<AgendaProposalPlacement, "startsAt" | "endsAt">,
  right: Pick<AgendaProposalPlacement, "startsAt" | "endsAt">,
): boolean {
  return left.startsAt < right.endsAt && right.startsAt < left.endsAt;
}

function shares(left: readonly string[], right: readonly string[]): boolean {
  const rightIds = new Set(right);
  return left.some((id) => rightIds.has(id));
}

function directlyRelated(
  candidate: AgendaProposalSession,
  occupiedSessionId: string,
  sessionById: ReadonlyMap<string, AgendaProposalSession>,
): boolean {
  return (
    candidate.parentSessionId === occupiedSessionId ||
    sessionById.get(occupiedSessionId)?.parentSessionId === candidate.id
  );
}

function isAvailable(
  candidate: AgendaProposalPlacement,
  session: AgendaProposalSession,
  occupied: readonly AgendaProposalPlacement[],
  sessionById: ReadonlyMap<string, AgendaProposalSession>,
): boolean {
  return occupied.every((placement) => {
    if (!overlaps(candidate, placement) || directlyRelated(session, placement.sessionId, sessionById)) return true;
    return (
      placement.roomId !== candidate.roomId &&
      !shares(placement.trackIds, candidate.trackIds) &&
      !shares(placement.speakerIds, candidate.speakerIds)
    );
  });
}

function schedulingOrder(
  sessions: readonly AgendaProposalSession[],
  scheduledSessionIds: ReadonlySet<string>,
): readonly AgendaProposalSession[] {
  const unscheduled = sessions.filter(({ id }) => !scheduledSessionIds.has(id));
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const depth = (session: AgendaProposalSession): number => {
    let current = session;
    let result = 0;
    const visited = new Set([session.id]);
    while (current.parentSessionId) {
      const parent = sessionById.get(current.parentSessionId);
      if (!parent || visited.has(parent.id)) break;
      visited.add(parent.id);
      current = parent;
      result += 1;
    }
    return result;
  };
  return unscheduled.toSorted(
    (left, right) =>
      depth(left) - depth(right) || right.durationMinutes - left.durationMinutes || left.id.localeCompare(right.id),
  );
}

function sessionWindow(
  bounds: AgendaProposalBounds,
  session: AgendaProposalSession,
  occupied: readonly AgendaProposalPlacement[],
): AgendaProposalBounds | null {
  if (!session.parentSessionId) return bounds;
  const parent = occupied.find(({ sessionId }) => sessionId === session.parentSessionId);
  return parent ? { startsAt: parent.startsAt, endsAt: parent.endsAt } : null;
}

export function proposeAgendaSchedule(
  bounds: AgendaProposalBounds,
  sessions: readonly AgendaProposalSession[],
  rooms: readonly AgendaProposalRoom[],
  currentPlacements: readonly AgendaProposalPlacement[],
): AgendaProposalPlan {
  const proposals: AgendaScheduleProposal[] = [];
  const unplaced: UnplacedAgendaSession[] = [];
  const occupied: AgendaProposalPlacement[] = currentPlacements.map((placement) => ({ ...placement }));
  const scheduledSessionIds = new Set(currentPlacements.map(({ sessionId }) => sessionId));
  const sessionById = new Map(sessions.map((session) => [session.id, session]));

  for (const session of schedulingOrder(sessions, scheduledSessionIds)) {
    const window = sessionWindow(bounds, session, occupied);
    if (!window) {
      unplaced.push({
        sessionId: session.id,
        title: session.title,
        reason: "Its parent session could not be placed.",
      });
      continue;
    }

    let proposal: AgendaScheduleProposal | null = null;
    for (
      let startsAt = new Date(window.startsAt);
      addMinutes(startsAt, session.durationMinutes) <= window.endsAt && !proposal;
      startsAt = addMinutes(startsAt, PROPOSAL_INCREMENT_MINUTES)
    ) {
      const endsAt = addMinutes(startsAt, session.durationMinutes);
      for (const room of rooms) {
        const candidate: AgendaScheduleProposal = {
          sessionId: session.id,
          title: session.title,
          durationMinutes: session.durationMinutes,
          startsAt,
          endsAt,
          roomId: room.id,
          roomName: room.name,
          trackIds: session.trackIds,
          speakerIds: session.speakerIds,
        };
        if (isAvailable(candidate, session, occupied, sessionById)) {
          proposal = candidate;
          break;
        }
      }
    }

    if (!proposal) {
      unplaced.push({
        sessionId: session.id,
        title: session.title,
        reason: rooms.length === 0 ? "No rooms are configured." : "No conflict-free time remains in the event window.",
      });
      continue;
    }
    proposals.push(proposal);
    occupied.push(proposal);
  }

  return { proposals, unplaced };
}
