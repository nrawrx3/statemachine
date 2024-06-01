import { assert } from "chai";
import { StateMachine } from "../src";

function createContestStatesAndTriggerArgsMap() {
  type ContestState =
    | "idle"
    | "idle_full"
    | "idle_not_full"
    | "kickoff"
    | "live"
    | "extra_time"
    | "done";

  type TriggerArgsMap = {
    playerJoinRequest: {
      playerID: string;
    };

    enterKickoff: {
      timestamp: number;
    };

    start: {
      timestamp: number;
    };

    enterExtraTime: {
      timestamp: number;
    };

    timeUp: {
      timestamp: number;
    };
  };

  const sm = new StateMachine<ContestState, TriggerArgsMap, Error>();

  const extendedState = {
    playerCount: 0,
    startsAt: 0,
    endsAt: 0,
    exactEndedAt: 0,

    config: {
      maxPlayers: 5,
      kickOffDuration: 5,
    },
  };

  const idle = sm.createState("idle");
  const idleFull = sm.createState("idle_full");
  const idleNotFull = sm.createState("idle_not_full");
  const kickoff = sm.createState("kickoff");
  const live = sm.createState("live");
  const extraTime = sm.createState("extra_time");
  const done = sm.createState("done");

  return {
    sm,
    extendedState,
    idle,
    idleFull,
    idleNotFull,
    kickoff,
    live,
    extraTime,
    done,
  };
}

describe("Building a StateMachine", () => {
  const {
    sm,
    extendedState,
    idle,
    idleFull,
    idleNotFull,
    kickoff,
    live,
    extraTime,
    done,
  } = createContestStatesAndTriggerArgsMap();

  idle
    .permitDynamic("playerJoinRequest", (args) => {
      if (extendedState.playerCount === extendedState.config.maxPlayers) {
        console.log("playerJoinRequest ==> idle_full");
        return ["idle_full", null];
      }
      return ["idle_not_full", null];
    })
    .permit("enterKickoff", "kickoff")
    .onEntryFrom("playerJoinRequest", (args) => {
      extendedState.playerCount++;
      return null;
    });

  idleFull.makeSubstateOf(idle);
  idleNotFull.makeSubstateOf(idle);

  kickoff.permit("start", "live");
  kickoff.onEntryFrom("enterKickoff", (args) => {
    extendedState.startsAt = args.timestamp;
    return null;
  });

  const result = sm.setInitialState("idle").fire("playerJoinRequest", {
    playerID: "player1",
  });

  if (result.resultKind === "failed") {
    assert.fail("Expected success");
  }

  assert.equal(extendedState.playerCount, 1);

  assert.equal(result.reportedTransitions?.nextStateInDifferentTree, false);
  assert.deepEqual(result.reportedTransitions?.onEntryCallbacksCalled, [
    "idle_not_full",
    "idle",
  ]);
});

describe("Full state disallows player join", () => {
  const {
    sm,
    extendedState,
    idle,
    idleFull,
    idleNotFull,
    kickoff,
    live,
    extraTime,
    done,
  } = createContestStatesAndTriggerArgsMap();

  extendedState.playerCount = extendedState.config.maxPlayers - 1;

  idle
    .permitDynamic("playerJoinRequest", (args) => {
      if (extendedState.playerCount === extendedState.config.maxPlayers) {
        return ["idle_full", null];
      }
      return ["idle_not_full", null];
    })
    .permit("enterKickoff", "kickoff")
    .onEntryFrom("playerJoinRequest", (args) => {
      console.log("Entering state idle again");
      extendedState.playerCount++;
      return null;
    });

  idleFull
    .makeSubstateOf(idle)
    .permit("playerJoinRequest", "idle_full")
    .onEntryFrom("playerJoinRequest", (args, previousState) => {
      if (previousState !== "idle_full") {
        extendedState.playerCount++;
      }
      return null;
    });

  idleNotFull.makeSubstateOf(idle);

  kickoff.permit("start", "live");
  kickoff.onEntryFrom("enterKickoff", (args) => {
    extendedState.startsAt = args.timestamp;
    return null;
  });

  const result = sm.setInitialState("idle_full").fire("playerJoinRequest", {
    playerID: "player1",
  });

  assert.equal(result.resultKind, "success");
  if (result.resultKind === "failed") {
    assert.fail("Expected success");
  }

  assert.deepEqual(result.nextState, "idle_full");
  assert.deepEqual(result.reportedTransitions?.onEntryCallbacksCalled, [
    "idle_full",
    "idle",
  ]);
});

describe("Live state with nested extra time state", () => {
  const {
    sm,
    extendedState,
    idle,
    idleFull,
    idleNotFull,
    kickoff,
    live,
    extraTime,
    done,
  } = createContestStatesAndTriggerArgsMap();

  extendedState.playerCount = extendedState.config.maxPlayers - 1;

  idle
    .permitDynamic("playerJoinRequest", (args) => {
      if (extendedState.playerCount === extendedState.config.maxPlayers) {
        return ["idle_full", null];
      }
      return ["idle_not_full", null];
    })
    .permit("enterKickoff", "kickoff")
    .permit("start", "live")
    .onEntryFrom("playerJoinRequest", (args) => {
      console.log("Entering state idle again");
      extendedState.playerCount++;
      return null;
    });

  idleFull
    .makeSubstateOf(idle)
    .permit("playerJoinRequest", "idle_full")
    .onEntryFrom("playerJoinRequest", (args, previousState) => {
      if (previousState !== "idle_full") {
        extendedState.playerCount++;
      }
      return null;
    });

  idleNotFull.makeSubstateOf(idle);

  kickoff.permit("start", "live");
  kickoff.onEntryFrom("enterKickoff", (args) => {
    extendedState.startsAt = args.timestamp;
    return null;
  });

  let liveStateEnteredAfterExtraTime = false;
  let liveStateEnteredCommon = false;

  live
    .permit("enterExtraTime", "extra_time")
    .onEntryFrom("start", (args) => {
      console.log("Entering live state from start trigger");
      return null;
    })
    .onEntryFrom("enterExtraTime", (args) => {
      console.log("Entering live state from extra time trigger");
      liveStateEnteredAfterExtraTime = true;
      return null;
    })
    .onEntryCommon((args) => {
      console.log("Entering live state");
      liveStateEnteredCommon = true;
      return null;
    });

  extraTime.makeSubstateOf(live).permit("timeUp", "done");

  done.onEntryFrom("timeUp", (args) => {
    extendedState.exactEndedAt = args.timestamp;
    return null;
  });

  const result = sm.setInitialState("idle_not_full").fire("start", {
    timestamp: 5,
  });

  if (result.resultKind === "failed") {
    assert.fail("Expected success");
  }

  assert.equal(result.reportedTransitions?.nextStateInDifferentTree, true);
  assert.deepEqual(result.nextState, "live");
  assert.deepEqual(result.reportedTransitions?.onEntryCallbacksCalled, [
    "live",
  ]);

  // TODO: Go to extra time state. The live state callback will be called again.
  sm.fire("enterExtraTime", { timestamp: 10 });

  assert.equal(liveStateEnteredAfterExtraTime, true);
  assert.equal(liveStateEnteredCommon, true);
});
