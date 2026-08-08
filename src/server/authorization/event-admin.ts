import type { Event, Room, Track } from "@/generated/prisma/client";
import type {
  CreateRoomInput,
  CreateTrackInput,
  EventRepository,
  RoomRepository,
  TrackRepository,
  UpdateEventInput,
} from "@/server/events/repositories";

import { organizerEventIds, requireAuthenticatedPrincipal } from "./policy";
import { EventScopedAuthorizer, type PrincipalProvider } from "./scoped-operations";

export interface EventAdminRepositories {
  readonly events: Pick<EventRepository, "list" | "get" | "update" | "delete">;
  readonly rooms: Pick<RoomRepository, "list" | "get" | "create" | "update" | "delete" | "reorder">;
  readonly tracks: Pick<TrackRepository, "list" | "get" | "create" | "update" | "delete" | "reorder">;
}

export class EventAdminOperations {
  private readonly repositories: EventAdminRepositories;
  private readonly getPrincipal: PrincipalProvider;
  private readonly authorizer: EventScopedAuthorizer;

  constructor(repositories: EventAdminRepositories, getPrincipal: PrincipalProvider) {
    this.repositories = repositories;
    this.getPrincipal = getPrincipal;
    this.authorizer = new EventScopedAuthorizer(getPrincipal);
  }

  async listEvents(): Promise<Event[]> {
    const principal = requireAuthenticatedPrincipal(await this.getPrincipal());
    return this.repositories.events.list(organizerEventIds(principal));
  }

  async getEvent(eventId: string): Promise<Event | null> {
    await this.authorizer.requireOrganizer(eventId, "read");
    return this.repositories.events.get(eventId);
  }

  async updateEvent(eventId: string, input: UpdateEventInput): Promise<Event> {
    await this.authorizer.requireOrganizer(eventId, "write");
    return this.repositories.events.update(eventId, input);
  }

  async deleteEvent(eventId: string): Promise<void> {
    await this.authorizer.requireOrganizer(eventId, "write");
    await this.repositories.events.delete(eventId);
  }

  async listRooms(eventId: string): Promise<Room[]> {
    await this.authorizer.requireOrganizer(eventId, "read");
    return this.repositories.rooms.list(eventId);
  }

  async getRoom(eventId: string, roomId: string): Promise<Room | null> {
    await this.authorizer.requireOrganizer(eventId, "read");
    return this.repositories.rooms.get(eventId, roomId);
  }

  async createRoom(input: CreateRoomInput): Promise<Room> {
    await this.authorizer.requireOrganizer(input.eventId, "write");
    return this.repositories.rooms.create(input);
  }

  async updateRoom(eventId: string, roomId: string, name: string): Promise<Room> {
    await this.authorizer.requireOrganizer(eventId, "write");
    return this.repositories.rooms.update(eventId, roomId, name);
  }

  async deleteRoom(eventId: string, roomId: string): Promise<void> {
    await this.authorizer.requireOrganizer(eventId, "write");
    await this.repositories.rooms.delete(eventId, roomId);
  }

  async reorderRooms(eventId: string, orderedIds: readonly string[]): Promise<Room[]> {
    await this.authorizer.requireOrganizer(eventId, "write");
    return this.repositories.rooms.reorder(eventId, orderedIds);
  }

  async listTracks(eventId: string): Promise<Track[]> {
    await this.authorizer.requireOrganizer(eventId, "read");
    return this.repositories.tracks.list(eventId);
  }

  async getTrack(eventId: string, trackId: string): Promise<Track | null> {
    await this.authorizer.requireOrganizer(eventId, "read");
    return this.repositories.tracks.get(eventId, trackId);
  }

  async createTrack(input: CreateTrackInput): Promise<Track> {
    await this.authorizer.requireOrganizer(input.eventId, "write");
    return this.repositories.tracks.create(input);
  }

  async updateTrack(
    eventId: string,
    trackId: string,
    input: { readonly name?: string; readonly color?: string },
  ): Promise<Track> {
    await this.authorizer.requireOrganizer(eventId, "write");
    return this.repositories.tracks.update(eventId, trackId, input);
  }

  async deleteTrack(eventId: string, trackId: string): Promise<void> {
    await this.authorizer.requireOrganizer(eventId, "write");
    await this.repositories.tracks.delete(eventId, trackId);
  }

  async reorderTracks(eventId: string, orderedIds: readonly string[]): Promise<Track[]> {
    await this.authorizer.requireOrganizer(eventId, "write");
    return this.repositories.tracks.reorder(eventId, orderedIds);
  }
}
