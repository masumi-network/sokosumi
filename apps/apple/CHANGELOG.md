# Changelog

## [1.0.1](https://github.com/masumi-network/sokosumi/compare/macos-v1.0.0...macos-v1.0.1) (2026-10-15)


### Bug Fixes

* **apple:** make bare URLs, www hosts and emails in messages clickable ([#6360](https://github.com/masumi-network/sokosumi/issues/6360)) ([92dda28](https://github.com/masumi-network/sokosumi/commit/92dda28a7d771620ede39c2c51d97228358e526c))
* **apple:** read realtime channel names from the token capability ([#6377](https://github.com/masumi-network/sokosumi/issues/6377)) ([8f03335](https://github.com/masumi-network/sokosumi/commit/8f0333579e4bd6abbf82d4ef21099c1f8d6118ac))
* **apple:** say who reacted the moment the pointer is on a reaction chip ([#6374](https://github.com/masumi-network/sokosumi/issues/6374)) ([7b6d5a3](https://github.com/masumi-network/sokosumi/commit/7b6d5a32b3d78e5682716b815ae47a2e2866f414))
* **apple:** say who reacted when a reaction chip holds keyboard focus ([#6376](https://github.com/masumi-network/sokosumi/issues/6376)) ([6d152ac](https://github.com/masumi-network/sokosumi/commit/6d152ac69fd2f1ab650cb8b97475143e701d7ea2))

## 1.0.0 (2026-10-14)


### Features

* **apple:** let Settings turn off automatic update checks ([#6356](https://github.com/masumi-network/sokosumi/issues/6356)) ([1d97a3d](https://github.com/masumi-network/sokosumi/commit/1d97a3d6b931abb1f9f09adce4591af47634b506))
* Initial release ([ec2db07](https://github.com/masumi-network/sokosumi/commit/ec2db07b56b7ae52b52b2fb90f83b3785e8c2843))


### Bug Fixes

* **apple:** de-duplicate older pages in the cross-room Threads list ([#6269](https://github.com/masumi-network/sokosumi/issues/6269)) ([c02e251](https://github.com/masumi-network/sokosumi/commit/c02e251744e7c2d536be7bf8ee02a05549171081))
* **apple:** derive the Thread's reply rows with the room's rules ([#6277](https://github.com/masumi-network/sokosumi/issues/6277)) ([46adec9](https://github.com/masumi-network/sokosumi/commit/46adec962dcc9018b10402a2e356b077a9042761))
* **apple:** follow the Thread like the room and return to latest on send ([#6264](https://github.com/masumi-network/sokosumi/issues/6264)) ([30936af](https://github.com/masumi-network/sokosumi/commit/30936affe529587fe7e66abe181f3b19fe4164a8))
* **apple:** keep a created or joined room when an older list read lands ([#6334](https://github.com/masumi-network/sokosumi/issues/6334)) ([e145311](https://github.com/masumi-network/sokosumi/commit/e1453115fa7fee1f8bfdbb9e6264b31818f61f24))
* **apple:** keep an in-flight room jump when the same row is requested again ([#6241](https://github.com/masumi-network/sokosumi/issues/6241)) ([1092137](https://github.com/masumi-network/sokosumi/commit/10921371a1962e9bad5f3b579a57474bae7531ee))
* **apple:** land a gap-held latest refresh like any latest page ([#6239](https://github.com/masumi-network/sokosumi/issues/6239)) ([f068991](https://github.com/masumi-network/sokosumi/commit/f06899187d8fe25060ae8405201779f05cdf3942))
* **apple:** land the Thread's older replies once their Markdown is prepared ([#6309](https://github.com/masumi-network/sokosumi/issues/6309)) ([b93010d](https://github.com/masumi-network/sokosumi/commit/b93010d65f086bdc6ca3f7b5fdb776a61a810956))
* **apple:** order the message toolbar and More menu like web ([#6322](https://github.com/masumi-network/sokosumi/issues/6322)) ([318ee5f](https://github.com/masumi-network/sokosumi/commit/318ee5fec52c47ef84eb7342cbea50637c1b7700))
* **apple:** paste an image alone on the pasteboard into the composer ([#6330](https://github.com/masumi-network/sokosumi/issues/6330)) ([ae22393](https://github.com/masumi-network/sokosumi/commit/ae22393acf736732fc4e1cb691f171c354a34e2f))
* **apple:** show now on an undated social post preview like web ([#6348](https://github.com/masumi-network/sokosumi/issues/6348)) ([7294c93](https://github.com/masumi-network/sokosumi/commit/7294c93abf56b472b31b3f7478bc0a7d58be5b77))
* **apple:** show the Pins loading line for the first page only ([#6335](https://github.com/masumi-network/sokosumi/issues/6335)) ([053d87d](https://github.com/masumi-network/sokosumi/commit/053d87d2644af2ab27dd1fce0af4fcd04950f5a2))
* **apple:** stop membership subscriptions before the socket closes ([#6275](https://github.com/masumi-network/sokosumi/issues/6275)) ([fde3630](https://github.com/masumi-network/sokosumi/commit/fde36306a1213496ab43dbc6d894593b76d9a21a))
* **apple:** wait for a running room-list read before refreshing after a change ([#6274](https://github.com/masumi-network/sokosumi/issues/6274)) ([cb03c44](https://github.com/masumi-network/sokosumi/commit/cb03c4455b62325f4659de531dd013a9ae540399))
