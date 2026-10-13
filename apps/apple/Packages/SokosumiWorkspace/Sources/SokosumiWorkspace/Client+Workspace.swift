import CoreAPI
import Foundation
import OpenAPIRuntime
import SokosumiAuth
import SokosumiChat

public extension Client {
  /// The signed-in Core client every workspace request goes through. `build` names this app build to Core (ADR 0053).
  static func workspace(session: OAuthSession, cooldown: ChatReadCooldown, baseURL: URL, build: String) -> Client {
    .core(baseURL: baseURL, middlewares: workspaceMiddlewares(session: session, cooldown: cooldown, build: build))
  }
}

/// Outermost first, inside `Client.core`'s error middleware. The read cooldown waits before the bearer resolves its
/// token, so a delayed read goes out with a fresh one.
func workspaceMiddlewares(session: OAuthSession, cooldown: ChatReadCooldown, build: String) -> [any ClientMiddleware] {
  [
    ChatReadCooldownMiddleware(cooldown: cooldown, currentScope: { await session.generation }),
    BearerAuthMiddleware(session: session),
    ClientBuildMiddleware(build: build),
    GuestInviteLinkExpiryMiddleware()
  ]
}
