import Map "mo:core/Map";
import Time "mo:core/Time";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Runtime "mo:core/Runtime";
import Principal "mo:core/Principal";
import List "mo:core/List";
import Iter "mo:core/Iter";

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

  type Room = {
    creator : UserId;
    otherUser : ?UserId;
    messages : List.List<BridgeMessage>;
  };

  let rooms = Map.empty<RoomId, Room>();
  var nextRoomId = 0;

  public shared ({ caller }) func createRoom() : async RoomId {
    let id = nextRoomId;
    nextRoomId += 1;

    let newRoom : Room = {
      creator = caller;
      otherUser = null;
      messages = List.empty<BridgeMessage>();
    };
    rooms.add(id.toText(), newRoom);
    id.toText();
  };

  public shared ({ caller }) func joinRoom(roomId : RoomId) : async Bool {
    switch (rooms.get(roomId)) {
      case (null) { Runtime.trap("Room does not exist.") };
      case (?room) {
        if (room.otherUser == null) {
          let joinedRoom : Room = {
            creator = room.creator;
            otherUser = ?caller;
            messages = room.messages;
          };
          rooms.add(roomId, joinedRoom);
          true;
        } else {
          false;
        };
      };
    };
  };

  public query ({ caller }) func getAllMessagesFrom(roomId : RoomId, iterationStart : Nat) : async {
    creator : Principal;
    messages : [BridgeMessage];
  } {
    let room = rooms.get(roomId);
    switch (room) {
      case (null) {
        Runtime.trap("Room " # roomId # " does not exist.");
      };
      case (?room) {
        let messagesArray = room.messages.toArray();
        {
          creator = room.creator;
          messages = messagesArray.sliceToArray(
            iterationStart,
            messagesArray.size(),
          );
        };
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
        let newMessage : BridgeMessage = {
          speaker = message.speaker;
          payload = message.payload;
          languageCode = message.languageCode;
          timestamp = Time.now();
        };

        room.messages.add(newMessage);
        true;
      };
    };
  };

  public query ({ caller }) func fetchMessagesSinceForRoomId(
    roomId : RoomId,
    lastSeenMessageId : Nat,
  ) : async [BridgeMessage] {
    let room = rooms.get(roomId);
    switch (room) {
      case (null) {
        Runtime.trap("Room " # roomId # " does not exist.");
      };
      case (?room) {
        let messagesArray = room.messages.toArray();
        messagesArray.sliceToArray(lastSeenMessageId, messagesArray.size());
      };
    };
  };

  public query ({ caller }) func checkRoomExists(roomId : RoomId) : async Bool {
    rooms.containsKey(roomId);
  };
};
