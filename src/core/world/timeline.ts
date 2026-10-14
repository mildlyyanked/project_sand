import type { Beat } from '../types';
import type { Minutes, SceneState } from './types';

/** In-world time at the end of a path: the last beat that carries a time, else the story's opening time. */
export function clockAt(path: Beat[], clockStart: Minutes): Minutes {
  for (let i = path.length - 1; i >= 0; i--) if (path[i]!.at != null) return path[i]!.at!;
  return clockStart;
}

/** Scene state at the end of a path: the last beat that carries one, else the opening scene. */
export function sceneAt(path: Beat[], initial: SceneState): SceneState {
  for (let i = path.length - 1; i >= 0; i--) if (path[i]!.state) return path[i]!.state!;
  return initial;
}
