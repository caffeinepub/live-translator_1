/* eslint-disable */
// @ts-nocheck
import { IDL } from '@icp-sdk/core/candid';

export const BridgeMessage = IDL.Record({
  'languageCode' : IDL.Text,
  'timestamp' : IDL.Int,
  'speaker' : IDL.Text,
  'payload' : IDL.Text,
});

export const idlService = IDL.Service({
  'checkRoomExists' : IDL.Func([IDL.Text], [IDL.Bool], ['query']),
  'ensureRoom' : IDL.Func([IDL.Text], [], []),
  'fetchMessagesSinceForRoomId' : IDL.Func([IDL.Text, IDL.Nat], [IDL.Vec(BridgeMessage)], ['query']),
  'sendToRoom' : IDL.Func([IDL.Text, IDL.Record({ 'languageCode' : IDL.Text, 'speaker' : IDL.Text, 'payload' : IDL.Text })], [IDL.Bool], []),
});

export const idlInitArgs = [];

export const idlFactory = ({ IDL }) => {
  const BridgeMessage = IDL.Record({
    'languageCode' : IDL.Text,
    'timestamp' : IDL.Int,
    'speaker' : IDL.Text,
    'payload' : IDL.Text,
  });
  return IDL.Service({
    'checkRoomExists' : IDL.Func([IDL.Text], [IDL.Bool], ['query']),
    'ensureRoom' : IDL.Func([IDL.Text], [], []),
    'fetchMessagesSinceForRoomId' : IDL.Func([IDL.Text, IDL.Nat], [IDL.Vec(BridgeMessage)], ['query']),
    'sendToRoom' : IDL.Func([IDL.Text, IDL.Record({ 'languageCode' : IDL.Text, 'speaker' : IDL.Text, 'payload' : IDL.Text })], [IDL.Bool], []),
  });
};

export const init = ({ IDL }) => { return []; };
