import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export type RoomId = string;
export type SpeakerLabel = string;
export type Time = bigint;
export type LanguageCode = string;
export interface BridgeMessage {
    languageCode: LanguageCode;
    timestamp: Time;
    speaker: SpeakerLabel;
    payload: string;
}
export interface backendInterface {
    ensureRoom(roomId: RoomId): Promise<boolean>;
    checkRoomExists(roomId: RoomId): Promise<boolean>;
    fetchMessagesSinceForRoomId(roomId: RoomId, lastSeenMessageId: bigint): Promise<Array<BridgeMessage>>;
    sendToRoom(roomId: RoomId, message: {
        languageCode: LanguageCode;
        speaker: SpeakerLabel;
        payload: string;
    }): Promise<boolean>;
}
