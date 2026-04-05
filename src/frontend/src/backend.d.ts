import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export type Time = bigint;
export type LanguageCode = string;
export type RoomId = string;
export type SignalJson = string;
export type SpeakerLabel = string;
export interface SignalMessage {
    timestamp: Time;
    signal: SignalJson;
}
export interface BridgeMessage {
    languageCode: LanguageCode;
    timestamp: Time;
    speaker: SpeakerLabel;
    payload: string;
}
export interface backendInterface {
    checkRoomExists(roomId: RoomId): Promise<boolean>;
    ensureRoom(roomId: RoomId): Promise<boolean>;
    fetchMessagesSinceForRoomId(roomId: RoomId, lastSeenMessageId: bigint): Promise<Array<BridgeMessage>>;
    fetchSignals(roomId: RoomId, sinceIndex: bigint): Promise<Array<SignalMessage>>;
    sendToRoom(roomId: RoomId, message: {
        languageCode: LanguageCode;
        speaker: SpeakerLabel;
        payload: string;
    }): Promise<boolean>;
    storeSignal(roomId: RoomId, signal: SignalJson): Promise<bigint>;
}
