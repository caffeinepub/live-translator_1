import Map "mo:core/Map";
import Time "mo:core/Time";
import Text "mo:core/Text";
import Runtime "mo:core/Runtime";
import Principal "mo:core/Principal";
import List "mo:core/List";
import Order "mo:core/Order";

// Apply data migration on upgrade

actor {
  type UserId = Principal;
  type RoomId = Text;
  type LanguageCode = Text;
  type SpeakerLabel = Text;
  type SignalJson = Text;

  type BridgeMessage = {
    speaker : SpeakerLabel;
    payload : Text;
    languageCode : LanguageCode;
    timestamp : Time.Time;
  };

  type Room = {
    creator : UserId;
    otherUser : ?UserId;
    messages : List.List<BridgeMessage>;
  };

  type SignalMessage = {
    signal : SignalJson;
    timestamp : Time.Time;
  };

  let rooms = Map.empty<RoomId, Room>();
  type RoomSignalsState = {
    nextSignalId : Nat;
    signals : Map.Map<Nat, SignalMessage>;
  };
  let signalsPerRoom = Map.empty<RoomId, RoomSignalsState>();

  // Returns true if this caller is the room creator (Person A),
  // false if joining an already-existing room (Person B).
  public shared ({ caller }) func ensureRoom(roomId : RoomId) : async Bool {
    if (not rooms.containsKey(roomId)) {
      let newRoom : Room = {
        creator = caller;
        otherUser = null;
        messages = List.empty<BridgeMessage>();
      };
      rooms.add(roomId, newRoom);
      true; // creator
    } else {
      false; // joiner
    };
  };

  public query func checkRoomExists(roomId : RoomId) : async Bool {
    rooms.containsKey(roomId);
  };

  public query func fetchMessagesSinceForRoomId(
    roomId : RoomId,
    lastSeenMessageId : Nat,
  ) : async [BridgeMessage] {
    switch (rooms.get(roomId)) {
      case (null) { Runtime.trap("Room " # roomId # " does not exist.") };
      case (?room) {
        let arr = room.messages.toArray();
        arr.sliceToArray(lastSeenMessageId, arr.size());
      };
    };
  };

  public shared func sendToRoom(
    roomId : RoomId,
    message : {
      speaker : SpeakerLabel;
      payload : Text;
      languageCode : LanguageCode;
    },
  ) : async Bool {
    switch (rooms.get(roomId)) {
      case (null) { Runtime.trap("Room does not exist") };
      case (?room) {
        room.messages.add({
          speaker = message.speaker;
          payload = message.payload;
          languageCode = message.languageCode;
          timestamp = Time.now();
        });
        true;
      };
    };
  };

  public shared func storeSignal(
    roomId : RoomId,
    signal : SignalJson,
  ) : async Nat {
    let signalId : Nat = switch (signalsPerRoom.get(roomId)) {
      case (null) { 0 };
      case (?state) { state.nextSignalId };
    };
    let newSignal : SignalMessage = {
      signal;
      timestamp = Time.now();
    };
    let newState : RoomSignalsState = switch (signalsPerRoom.get(roomId)) {
      case (null) {
        { nextSignalId = 1; signals = Map.singleton(0, newSignal) };
      };
      case (?state) {
        state.signals.add(signalId, newSignal);
        {
          nextSignalId = signalId + 1;
          signals = state.signals;
        };
      };
    };
    signalsPerRoom.add(roomId, newState);
    signalId;
  };

  public query func fetchSignals(
    roomId : RoomId,
    sinceIndex : Nat,
  ) : async [SignalMessage] {
    switch (signalsPerRoom.get(roomId)) {
      case (null) { [] };
      case (?state) {
        // Collect all (signalId, signal) entries with signalId >= sinceIndex,
        // sorted by signalId ascending to ensure correct ICE candidate ordering
        let entries = state.signals
          .filter(func(id, _) { id >= sinceIndex })
          .entries()
          .toArray()
          .sort(func((a, _) : (Nat, SignalMessage), (b, _) : (Nat, SignalMessage)) : Order.Order {
            if (a < b) #less else if (a > b) #greater else #equal
          })
          .map(func((_, signal) : (Nat, SignalMessage)) : SignalMessage { signal });
        entries
      };
    };
  };
};
