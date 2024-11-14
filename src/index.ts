type StateTypeBase = string | number;
type TriggerArgsMapBase = { [trigger: string]: unknown };

function haveValue<T>(x: T | null | undefined) {
  return x !== null && x !== undefined;
}

export type TaggedGuard<
  StateType extends StateTypeBase,
  TriggerArgsTypeMap extends TriggerArgsMapBase,
  GuardTagType extends string
> = [
    GuardTagType,
    (trigger: keyof TriggerArgsTypeMap, triggerArg: any) => boolean
  ];

export type StateMachineTransitionSuccess<StateType extends StateTypeBase> = {
  resultKind: "success";
  nextState: StateType;
  reportedTransitions?: any; // TODO: Have a definite type for this.
};

export type StateMachineTransitionErrorKind = "noTransition" | "otherError";

export type StateMachineTransitionFailed<
  ErrorType,
  GuardTagType extends string
> = {
  resultKind: "failed";
  errorKind: StateMachineTransitionErrorKind;

  // Only valid if errorKind === "otherError"
  error?: ErrorType;

  // Only valid if and only if errorKind === "noTransition" and also if the
  // transition failed due to a guard check.
  failedGuardTag?: GuardTagType;
};

export type StateMachineFireResult<
  StateType extends StateTypeBase,
  ErrorType,
  GuardTagType extends string
> =
  | StateMachineTransitionSuccess<StateType>
  | StateMachineTransitionFailed<ErrorType, GuardTagType>;

export type inferStateMachineFireResult<StateMachineType> =
  StateMachineType extends StateMachine<
    infer StateType,
    infer TriggerArgsTypeMap,
    infer ErrorType,
    infer GuardTagType
  >
  ? StateMachineFireResult<StateType, ErrorType, GuardTagType>
  : never;


// The data for a state node in the state node forest. This object only contains
// info about a state and its relation with its parent and children. No info
// about transitions. That is something the StateNode type will hold.
export class StateTreeLinks<
  StateType extends StateTypeBase,
  TriggerArgsTypeMap extends TriggerArgsMapBase,
  ErrorType,
  GuardTagType extends string> {
  parentNode: StateNode<StateType, TriggerArgsTypeMap, ErrorType, GuardTagType> = null;
  substateNodes: StateNode<StateType, TriggerArgsTypeMap, ErrorType, GuardTagType>[] = [];

  parentLink: StateTreeLinks<StateType, TriggerArgsTypeMap, ErrorType, GuardTagType> = null;
  substateLinks: StateTreeLinks<StateType, TriggerArgsTypeMap, ErrorType, GuardTagType>[] = [];

  state: NonNullable<StateType>;

  constructor(state: NonNullable<StateType>) {
    this.state = state;
  }

  isSubstateOf(state: StateType): boolean {
    return this.parentLink?.state === state;
  }

  isDescendantOf(state: StateType): boolean {
    if (this.parentLink?.state === state) {
      return true;
    }

    return this.parentLink?.isDescendantOf(state) ?? false;
  }

  toJSON() {
    return {
      state: this.state,
      parent: this.parentLink?.state,
      substates: this.substateNodes.map((substate) => substate.link.toJSON()),
    };
  }
}

// Contains the state transition related info of the state.
export class StateNode<
  StateType extends StateTypeBase,
  TriggerArgsTypeMap extends TriggerArgsMapBase,
  ErrorType,
  GuardTagType extends string
> {
  link: StateTreeLinks<StateType, TriggerArgsTypeMap, ErrorType, GuardTagType>;

  stateMachine: StateMachine<
    StateType,
    TriggerArgsTypeMap,
    ErrorType,
    GuardTagType
  >;

  onEntryFromTriggerCallbacks: Map<
    keyof TriggerArgsTypeMap,
    (triggerArg: any, previousState: StateType) => ErrorType | null
  > = new Map();

  onEntryCommonCallback: (previousState: StateType) => ErrorType | null = null;

  permitDeciderCallbacksForTrigger: Map<
    keyof TriggerArgsTypeMap,
    [
      // Decider callback
      (triggerArg: any) => [StateType, ErrorType | null],
      // Guards
      TaggedGuard<StateType, TriggerArgsTypeMap, GuardTagType>[]
    ]
  > = new Map();

  permitTriggerNextState: Map<
    keyof TriggerArgsTypeMap,
    [
      // Next state
      StateType,
      // Guards
      TaggedGuard<StateType, TriggerArgsTypeMap, GuardTagType>[]
    ]
  > = new Map();

  constructor(
    state: StateType,
    machine: StateMachine<
      StateType,
      TriggerArgsTypeMap,
      ErrorType,
      GuardTagType
    >
  ) {
    this.link = new StateTreeLinks(state);
    this.stateMachine = machine;
  }

  get state() {
    return this.link.state;
  }

  onEntryFrom<T extends keyof TriggerArgsTypeMap>(
    trigger: T,
    callback: (
      args: TriggerArgsTypeMap[T],
      previousState: StateType
    ) => ErrorType | null
  ) {
    this.onEntryFromTriggerCallbacks.set(trigger, callback);
    return this;
  }

  onEntry(callback: (previousState: StateType) => ErrorType | null) {
    this.onEntryCommonCallback = callback;
    return this;
  }

  onEntryCommon(callback: (previousState: StateType) => ErrorType | null) {
    return this.onEntry(callback);
  }

  permit<T extends keyof TriggerArgsTypeMap>(
    trigger: T,
    nextState: StateType,
    ...guards: TaggedGuard<StateType, TriggerArgsTypeMap, GuardTagType>[]
  ) {
    this.permitTriggerNextState.set(trigger, [nextState, guards]);
    return this;
  }

  permitDynamic<T extends keyof TriggerArgsTypeMap>(
    trigger: T,
    callback: (args: TriggerArgsTypeMap[T]) => [StateType, ErrorType | null],
    ...guards: TaggedGuard<StateType, TriggerArgsTypeMap, GuardTagType>[]
  ) {
    this.permitDeciderCallbacksForTrigger.set(trigger, [callback, guards]);
    return this;
  }

  makeSubstateOf(
    parentState: StateNode<
      StateType,
      TriggerArgsTypeMap,
      ErrorType,
      GuardTagType
    >
  ) {
    parentState.link.substateNodes.push(this);
    this.link.parentNode = parentState;

    parentState.link.substateLinks.push(this.link);
    this.link.parentLink = parentState.link;

    this.stateMachine.setStateAsNonRoot(this.state);
    return this;
  }

  IsInState(state: StateType) {
    if (this.state === state) {
      return true;
    }
    return this.link.parentNode?.IsInState(state) ?? false;
  }

  getParentState() {
    return this.link.parentNode;
  }

  private countStatesHavingThisAsParent(
    found: boolean[],
    foundCount: number,
    states: StateType[]
  ) {
    for (let substate of this.link.substateNodes) {
      for (let i = 0; i < states.length; i++) {
        if (found[i]) {
          continue;
        }

        if (substate.state === states[i]) {
          found[i] = true;
          foundCount++;

          // Early return
          if (foundCount >= states.length) {
            return foundCount;
          }
        }
      }
    }

    if (foundCount < states.length) {
      for (let substate of this.link.substateNodes) {
        substate.countStatesHavingThisAsParent(found, foundCount, states);
        if (foundCount >= states.length) {
          return foundCount;
        }
      }
    }

    return foundCount;
  }

  containsAllGivenSubstates(substates: StateType[]) {
    const found = new Array(substates.length).fill(false);
    const foundCount = this.countStatesHavingThisAsParent(found, 0, substates);
    return foundCount === substates.length;
  }

  decideNextState<T extends keyof TriggerArgsTypeMap>(
    trigger: T,
    arg: TriggerArgsTypeMap[T]
  ): StateMachineFireResult<StateType, ErrorType, GuardTagType> {
    // console.log(
    //   "decideNextState from state node",
    //   this.state,
    //   "trigger",
    //   trigger,
    //   "arg",
    //   arg
    // );

    // Check if this state permits the trigger with decider callback registered
    // by permitDynamic().
    const permitDynamicValue =
      this.permitDeciderCallbacksForTrigger.get(trigger);
    if (permitDynamicValue) {
      const permitDecider = permitDynamicValue[0];
      const guards = permitDynamicValue[1];

      // First check that guards allow this transition.
      const failedGuardTag = this.callGuards(guards, trigger, arg);
      if (haveValue(failedGuardTag)) {
        return {
          resultKind: "failed",
          errorKind: "noTransition",
          failedGuardTag,
        };
      }
      // console.log("decider found, calling");
      const [nextStateTag, error] = permitDecider(arg);
      if (error) {
        // console.log("decider returned error:", error);
        return { resultKind: "failed", errorKind: "otherError", error };
      }

      // console.log("decider returned nextStateTag:", nextStateTag);
      return { resultKind: "success", nextState: nextStateTag };
    }

    // Check if this state itself permits the trigger non-dynamically registered
    // by permit().
    const permitValue = this.permitTriggerNextState.get(trigger);
    if (permitValue) {
      const failedGuardTag = this.callGuards(permitValue[1], trigger, arg);
      if (haveValue(failedGuardTag)) {
        return {
          resultKind: "failed",
          errorKind: "noTransition",
          failedGuardTag,
        };
      }

      return { resultKind: "success", nextState: permitValue[0] };
    }

    // Check if the parent (or ancestor) state permits the trigger. Call
    // decideNextState() recursively.
    if (this.link.parentNode) {
      return this.link.parentNode.decideNextState(trigger, arg);
    }

    return { resultKind: "failed", errorKind: "noTransition" };
  }

  private callGuards(
    guards: TaggedGuard<StateType, TriggerArgsTypeMap, GuardTagType>[],
    trigger: keyof TriggerArgsTypeMap,
    triggerArg: TriggerArgsTypeMap[keyof TriggerArgsTypeMap]
  ): GuardTagType | null {
    for (let guard of guards) {
      const [guardTag, guardCallback] = guard;
      if (!guardCallback(trigger, triggerArg)) {
        return guardTag;
      }
    }
    return null;
  }

  doCallbacksOnEntry<T extends keyof TriggerArgsTypeMap>(
    trigger: T,
    previousState: StateNode<
      StateType,
      TriggerArgsTypeMap,
      ErrorType,
      GuardTagType
    >,
    arg: TriggerArgsTypeMap[T]
  ): ErrorType | null {
    if (this.onEntryCommonCallback) {
      const result = this.onEntryCommonCallback(previousState.state);
      if (result !== null) {
        return result;
      }
    }

    const onEntryFromTriggerCallback =
      this.onEntryFromTriggerCallbacks.get(trigger);
    if (onEntryFromTriggerCallback) {
      return onEntryFromTriggerCallback(arg, previousState.state);
    }
    return null;
  }

  getRootStateNode(): NonNullable<
    StateNode<StateType, TriggerArgsTypeMap, ErrorType, GuardTagType>
  > {
    if (this.link.parentNode) {
      return this.link.parentNode.getRootStateNode();
    }
    return this;
  }

  // TODO: Remove. Unused. We are using different semantics.
  static lowestCommonAncestor<
    StateType extends StateTypeBase,
    TriggerArgsTypeMap extends TriggerArgsMapBase,
    ErrorType,
    GuardTagType extends string
  >(
    root: StateNode<StateType, TriggerArgsTypeMap, ErrorType, GuardTagType>,
    stateA: StateType,
    stateB: StateType
  ) {
    if (root === null) {
      return null;
    }

    if (root.state === stateA || root.state === stateB) {
      return root;
    }

    const commonAncestors: StateNode<
      StateType,
      TriggerArgsTypeMap,
      ErrorType,
      GuardTagType
    >[] = [];

    for (let substate of root.link.substateNodes) {
      const ancestor = StateNode.lowestCommonAncestor(substate, stateA, stateB);
      if (ancestor) {
        commonAncestors.push(ancestor);
      }
    }

    if (commonAncestors.length === 2) {
      return root;
    }

    if (commonAncestors.length > 0) {
      return commonAncestors[0];
    }
    return null;
  }
}

export class StateMachine<
  StateType extends StateTypeBase,
  TriggerArgsMap extends TriggerArgsMapBase,
  ErrorType,
  GuardTagType extends string = string
> {
  private currentStateNode: StateNode<
    StateType,
    TriggerArgsMap,
    ErrorType,
    GuardTagType
  >;
  private stateMap: Map<
    StateType,
    StateNode<StateType, TriggerArgsMap, ErrorType, GuardTagType>
  > = new Map();

  rootStates = new Set<StateType>();

  // Called when next state has been decided via a permit rule but corresponding onEntry callbacks have not been called yet.
  private onTransitioningCallback: (
    prevState: StateType,
    nextState: StateType
  ) => any = null;

  // Called when next state has been decided via a permit rule and the corresponding onEntry callbacks have also been called.
  private onTransitionedCallback: (
    prevState: StateType,
    nextState: StateType
  ) => any = null;

  setInitialState(state: StateType) {
    this.currentStateNode = this.stateMap.get(state);
    if (!this.currentStateNode) {
      throw new Error(`No state object for state ${state}`);
    }
    return this;
  }

  createState(
    stateTag: StateType
  ): StateNode<StateType, TriggerArgsMap, ErrorType, GuardTagType> {
    let state = this.stateMap.get(stateTag);

    if (!state) {
      state = new StateNode<StateType, TriggerArgsMap, ErrorType, GuardTagType>(
        stateTag,
        this
      );
      this.stateMap.set(stateTag, state);
    }

    this.rootStates.add(stateTag);

    return state;
  }

  // Create state nodes in one call. Does not check for duplicates.
  createStates(stateTags: StateType[]) {
    return stateTags.map((stateTag) => this.createState(stateTag));
  }

  getState(stateTag: StateType) {
    return this.stateMap.get(stateTag);
  }

  get currentState() {
    return this.currentStateNode.state;
  }

  setStateAsNonRoot(stateTag: StateType) {
    this.rootStates.delete(stateTag);
    return this;
  }

  printStateTree() {
    let obj = {};
    this.rootStates.forEach((root) => {
      obj = { ...obj, ...this.printStateTreeForRoot(this.stateMap.get(root)) };
    });
    return obj;
  }

  private printStateTreeForRoot(
    root: StateNode<StateType, TriggerArgsMap, ErrorType, GuardTagType>
  ) {
    let obj = {};

    for (let substate of root.link.substateNodes) {
      obj = { ...obj, ...this.printStateTreeForRoot(substate) };
    }
    return { [root.state]: obj };
  }

  fire<T extends keyof TriggerArgsMap>(
    trigger: T,
    arg: TriggerArgsMap[T],
    reportTransitions = true
  ) {
    return this.fireTriggerAndRunEntryCallbacks(
      trigger,
      arg,
      reportTransitions
    );
  }

  onTransitioned(
    callback: (nextState: StateType, previousState: StateType) => any
  ) {
    this.onTransitionedCallback = callback;
  }

  onTransitioning(
    callback: (nextState: StateType, previousState: StateType) => any
  ) {
    this.onTransitioningCallback = callback;
  }

  private fireTriggerAndRunEntryCallbacks<T extends keyof TriggerArgsMap>(
    trigger: T,
    arg: TriggerArgsMap[T],
    reportTransitions = true
  ): StateMachineFireResult<StateType, ErrorType, GuardTagType> {
    if (!this.currentStateNode) {
      throw new Error("State machine initial state has not been set");
    }

    const stateBeforeTransition = this.currentStateNode;

    const deciderResult = this.currentStateNode.decideNextState(trigger, arg);

    if (deciderResult.resultKind === "failed") {
      return deciderResult;
    }

    // Call the onTransitioning callback.
    if (haveValue(this.onTransitioningCallback)) {
      this.onTransitioningCallback(
        deciderResult.nextState,
        stateBeforeTransition.state
      );
    }

    // Call any installed onEntryFrom callback on the new state.
    const nextStateNode = this.stateMap.get(deciderResult.nextState);
    if (!nextStateNode) {
      throw new Error(`No state object for state ${nextStateNode}`);
    }

    const reportedTransitions = {
      onEntryCallbacksCalled: [] as any[],
      nextStateInDifferentTree: true,
      currentState: this.currentStateNode.state,
      nextState: nextStateNode.state,
    };

    // If nextState is not in the same state-tree as stateBeforeTransition, we
    // need to call the callbacks on each ancestor state upto the root. First
    // check if both belong to the same tree. If not, just call the callbacks
    // upto the root node of the next state's tree. Otherwise, call the callback
    // upto (but excluding) the LCA node.
    const rootStateOfThis = this.currentStateNode.getRootStateNode();
    const rootStateOfNext = nextStateNode.getRootStateNode();

    if (rootStateOfThis === rootStateOfNext) {
      reportedTransitions.nextStateInDifferentTree = false;
    }

    let s = nextStateNode;

    while (s) {
      // console.log("up state: ", s.state);

      reportTransitions &&
        reportedTransitions.onEntryCallbacksCalled.push(s.state);

      const callbackError = s.doCallbacksOnEntry(
        trigger,
        stateBeforeTransition,
        arg
      );
      if (callbackError) {
        return {
          resultKind: "failed",
          errorKind: "otherError",
          error: callbackError,
        };
      }

      s = s.link.parentNode;
    }

    // Call the onTransitioned callback.
    if (haveValue(this.onTransitionedCallback)) {
      this.onTransitionedCallback(
        deciderResult.nextState,
        stateBeforeTransition.state
      );
    }

    this.currentStateNode = nextStateNode;
    return {
      resultKind: "success",
      nextState: nextStateNode.state,
      reportedTransitions: reportedTransitions,
    };
  }

  stateLinksTree(): Map<StateType, StateTreeLinks<StateType, TriggerArgsMap, ErrorType, GuardTagType>> {
    const linksMap: Map<StateType, StateTreeLinks<StateType, TriggerArgsMap, ErrorType, GuardTagType>> = new Map();
    this.rootStates.forEach((rootState) => {
      const rootNode = this.stateMap.get(rootState);
      const clonedTree = cloneStateLinksTree(rootNode.link, linksMap);
    })

    return linksMap;
  }
}

// Clone the stateTreeLinks in the state node tree. Also fill the given linksMap while cloning.
function cloneStateLinksTree<
  StateType extends StateTypeBase,
  TriggerArgsTypeMap extends TriggerArgsMapBase,
  ErrorType,
  GuardTagType extends string>(current: StateTreeLinks<StateType, TriggerArgsTypeMap, ErrorType, GuardTagType>,
    linksMap: Map<StateType, StateTreeLinks<StateType, TriggerArgsTypeMap, ErrorType, GuardTagType>>,
  ) {
  const currentClone = new StateTreeLinks<StateType, TriggerArgsTypeMap, ErrorType, GuardTagType>(current.state);
  linksMap.set(current.state, currentClone);

  for (let substate of current.substateNodes) {
    const substateLinks = cloneStateLinksTree(substate.link, linksMap);
    substateLinks.parentLink = currentClone;
    currentClone.substateLinks.push(substateLinks);
  }

  return currentClone;
}

// Helper type function to infer the type of the permit dynamic callback given
// the specialized type of the StateMachine<...>
export type inferPermitDynamicCallbackType<StateMachineType> =
  StateMachineType extends StateMachine<
    infer StateType,
    infer TriggerArgsTypeMap,
    infer ErrorType,
    infer GuardTagType
  >
  ? (
    triggerArg: TriggerArgsTypeMap[keyof TriggerArgsTypeMap]
  ) => [StateType, ErrorType | null]
  : never;

// Helper type function to infer the type of the permit callback given the
// specialized type of the StateMachine<...>
export type inferOnEntryFromCallbackType<StateMachineType> =
  StateMachineType extends StateMachine<
    infer StateType,
    infer TriggerArgsTypeMap,
    infer ErrorType,
    infer GuardTagType
  >
  ? (
    triggerArg: TriggerArgsTypeMap[keyof TriggerArgsTypeMap],
    previousState: StateType
  ) => ErrorType | null
  : never;

// Helper type function to infer the type of the permit callback given the
// specialized type of the StateMachine<...>
export type inferOnEntryCallbackType<StateMachineType> =
  StateMachineType extends StateMachine<
    infer StateType,
    infer TriggerArgsTypeMap,
    infer ErrorType,
    infer GuardTagType
  >
  ? (previousState: StateType) => ErrorType | null
  : never;

// Helper type function to infer the type of the permit callback given the
// specialized type of the StateMachine<...>
export type inferGuardCallbackType<StateMachineType> =
  StateMachineType extends StateMachine<
    infer StateType,
    infer TriggerArgsTypeMap,
    infer ErrorType,
    infer GuardTagType
  >
  ? (
    trigger: keyof TriggerArgsTypeMap,
    triggerArg: TriggerArgsTypeMap[keyof TriggerArgsTypeMap]
  ) => boolean
  : never;