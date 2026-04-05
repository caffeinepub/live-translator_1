/* eslint-disable */
// @ts-nocheck
import type { ActorMethod } from '@icp-sdk/core/agent';
import type { IDL } from '@icp-sdk/core/candid';

export interface BridgeMessage {
  'languageCode' : string,
  'timestamp' : bigint,
  'speaker' : string,
  'payload' : string,
}
export type RoomId = string;
export interface _SERVICE {
  'checkRoomExists' : ActorMethod<[RoomId], boolean>,
  'ensureRoom' : ActorMethod<[RoomId], undefined>,
  'fetchMessagesSinceForRoomId' : ActorMethod<[RoomId, bigint], Array<BridgeMessage>>,
  'sendToRoom' : ActorMethod<[RoomId, { 'languageCode' : string, 'speaker' : string, 'payload' : string }], boolean>,
}
export declare const idlService: IDL.ServiceClass;
export declare const idlInitArgs: IDL.Type[];
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
