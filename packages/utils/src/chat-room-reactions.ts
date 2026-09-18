/**
 * Cap on named reactors Core returns per emoji; `count` may still exceed it.
 * Web appends the viewer to a Pending reaction only while under this cap.
 */
export const MAX_LISTED_CHAT_REACTION_REACTORS = 20;
