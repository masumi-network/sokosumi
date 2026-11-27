# The Agent catalog owns availability and prices

Core’s Agent catalog owns availability, prices and rail readiness for a Network.
Routes ask the catalog for those answers and pass their Network scope.
Admin lists and edits may use `scope.networkDb` directly.
