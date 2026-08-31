import { RuleError } from "./errors.ts";

export type RpsChoice = "rock" | "paper" | "scissors";

export interface RpsResult {
  round: number;
  choices: Record<string, RpsChoice>;
  tie: boolean;
  winner?: string;
  loser?: string;
}

export interface RpsPublicState {
  status: "choosing" | "resolved";
  round: number;
  players: readonly [string, string];
  submitted: Record<string, boolean>;
  lastResult?: RpsResult;
  assignments?: { red: string; black: string };
}

export interface RpsSecretState {
  choices: Record<string, RpsChoice>;
}

export function createRpsState(
  firstPlayer: string,
  secondPlayer: string,
): { publicState: RpsPublicState; secretState: RpsSecretState } {
  if (!firstPlayer || !secondPlayer || firstPlayer === secondPlayer) {
    throw new RuleError("INVALID_PLAYERS", "石头剪刀布需要两名不同玩家");
  }
  return {
    publicState: {
      status: "choosing",
      round: 1,
      players: [firstPlayer, secondPlayer],
      submitted: { [firstPlayer]: false, [secondPlayer]: false },
    },
    secretState: { choices: {} },
  };
}

function winnerFor(
  first: RpsChoice,
  second: RpsChoice,
): 0 | 1 | undefined {
  if (first === second) return undefined;
  if (
    (first === "rock" && second === "scissors") ||
    (first === "scissors" && second === "paper") ||
    (first === "paper" && second === "rock")
  ) {
    return 0;
  }
  return 1;
}

export function submitRpsChoice(
  publicState: RpsPublicState,
  secretState: RpsSecretState,
  playerId: string,
  choice: RpsChoice,
  round: number,
): { publicState: RpsPublicState; secretState: RpsSecretState } {
  if (publicState.status !== "choosing") {
    throw new RuleError("RPS_FINISHED", "石头剪刀布已经结束");
  }
  if (!publicState.players.includes(playerId)) {
    throw new RuleError("NOT_PLAYER", "该用户不在本房间");
  }
  if (round !== publicState.round) {
    throw new RuleError("STALE_RPS_ROUND", "石头剪刀布轮次已变化");
  }
  if (publicState.submitted[playerId]) {
    throw new RuleError("CHOICE_LOCKED", "本轮选择已经锁定");
  }

  const nextPublic: RpsPublicState = {
    ...publicState,
    players: [...publicState.players] as [string, string],
    submitted: { ...publicState.submitted, [playerId]: true },
  };
  const nextSecret: RpsSecretState = {
    choices: { ...secretState.choices, [playerId]: choice },
  };

  const [firstPlayer, secondPlayer] = nextPublic.players;
  if (!nextPublic.submitted[firstPlayer] || !nextPublic.submitted[secondPlayer]) {
    return { publicState: nextPublic, secretState: nextSecret };
  }

  const firstChoice = nextSecret.choices[firstPlayer];
  const secondChoice = nextSecret.choices[secondPlayer];
  const winnerIndex = winnerFor(firstChoice, secondChoice);
  const choices = {
    [firstPlayer]: firstChoice,
    [secondPlayer]: secondChoice,
  };

  if (winnerIndex === undefined) {
    return {
      publicState: {
        status: "choosing",
        round: nextPublic.round + 1,
        players: [...nextPublic.players] as [string, string],
        submitted: { [firstPlayer]: false, [secondPlayer]: false },
        lastResult: { round: nextPublic.round, choices, tie: true },
      },
      secretState: { choices: {} },
    };
  }

  const winner = nextPublic.players[winnerIndex];
  const loser = nextPublic.players[winnerIndex === 0 ? 1 : 0];
  return {
    publicState: {
      ...nextPublic,
      status: "resolved",
      lastResult: {
        round: nextPublic.round,
        choices,
        tie: false,
        winner,
        loser,
      },
      assignments: { red: winner, black: loser },
    },
    secretState: { choices: {} },
  };
}
