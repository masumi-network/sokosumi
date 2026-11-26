import { mountView } from "../../shell/mount.tsx";
import {
  isEmpty,
  SOCIAL_EMPTY,
  SocialPosts,
  SocialPostsList,
} from "./SocialPosts.tsx";

mountView("social-posts", {
  skeleton: "cards",
  schema: SocialPostsList,
  isEmpty,
  empty: SOCIAL_EMPTY,
  refreshTool: "workspaces_social_posts",
  children: (data, context) => <SocialPosts data={data} context={context} />,
});
