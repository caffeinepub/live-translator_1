import Map "mo:core/Map";
import Time "mo:core/Time";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Runtime "mo:core/Runtime";
import Principal "mo:core/Principal";
import List "mo:core/List";

actor {
  type UserId = Principal;
  type RoomId = Text;
  type LanguageCode = Text;
  type SpeakerLabel = Text;

  type BridgeMessage = {
    speaker : SpeakerLabel;
    payload : Text;
    languageCode : LanguageCode;
    timestamp : Time.Time;
  };

  // Keep otherUser field for backward compatibility with existing stable storage
  type Room = {
    creator : UserId;
    otherUser : ?UserId;
    messages : List.List<BridgeMessage>;
  };

  let rooms = Map.empty<RoomId, Room>();
  var nextRoomId = 0;

  // Creates a room with the given custom ID if it does not already exist.
  public shared ({ caller }) func ensureRoom(roomId : RoomId) : async () {
    if (not rooms.containsKey(roomId)) {
      let newRoom : Room = {
        creator = caller;
        otherUser = null;
        messages = List.empty<BridgeMessage>();
      };
      rooms.add(roomId, newRoom);
    };
  };

  public query ({ caller }) func checkRoomExists(roomId : RoomId) : async Bool {
    rooms.containsKey(roomId);
  };

  public query ({ caller }) func fetchMessagesSinceForRoomId(
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

  public shared ({ caller }) func sendToRoom(
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
};
