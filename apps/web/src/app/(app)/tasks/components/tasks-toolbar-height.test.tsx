import { beforeEach, describe, expect, it } from "vitest";
import {
  readTasksToolbarHeight,
  rememberTasksToolbarHeight,
} from "./tasks-toolbar-height";

describe("tasks toolbar height", () => {
  beforeEach(() => sessionStorage.clear());

  it("gives back the height the board's toolbar had at this window width", () => {
    rememberTasksToolbarHeight(96);

    expect(readTasksToolbarHeight()).toBe(96);
  });

  it("forgets it at another width, where the toolbar wraps differently", () => {
    rememberTasksToolbarHeight(96);
    window.happyDOM.setInnerWidth(window.innerWidth + 200);

    expect(readTasksToolbarHeight()).toBeNull();
  });

  it("has nothing before the board has drawn its toolbar", () => {
    expect(readTasksToolbarHeight()).toBeNull();
  });
});
