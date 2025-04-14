import { Clock, DollarSign, Timer } from "lucide-react";

export default function NumberTalks() {
  return (
    <div className="mx-auto w-full">
      <h2 className="mb-16 text-5xl font-light">{"Numbers talks"}</h2>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-16">
        {/* Running Time */}
        <div className="border-quinary space-y-4 border-t pt-8">
          <div className="text-muted-foreground flex items-center gap-2 text-sm font-medium tracking-wider uppercase">
            <Clock className="h-4 w-4" />
            <span>{"Running Time"}</span>
          </div>
          <div>
            <h3 className="mb-10 text-2xl">
              {
                "The ultimate tool for streamlining your workflow. Experience an average of 2 hours saved each day as you effortlessly track and analyze your competitors."
              }
            </h3>
            <div className="flex items-start gap-2">
              <span className="text-7xl font-light">{"120"}</span>
              <span className="text-muted-foreground pt-2">{"min"}</span>
            </div>
          </div>
        </div>

        {/* Less Costs */}
        <div className="border-quinary space-y-4 border-t pt-8">
          <div className="text-muted-foreground flex items-center gap-2 text-sm font-medium tracking-wider uppercase">
            <DollarSign className="h-4 w-4" />
            <span>{"Less Costs"}</span>
          </div>
          <div>
            <h3 className="mb-10 text-2xl">
              {
                "Unlock significant cost savings with our service, averaging around $42 daily. Streamline your workflow and gain valuable insights into your competitors effortlessly."
              }
            </h3>
            <div className="flex items-start gap-2">
              <span className="text-7xl font-light">{"42"}</span>
              <span className="text-muted-foreground pt-2">
                {"% less costs"}
              </span>
            </div>
          </div>
        </div>

        {/* Time Savings */}
        <div className="border-quinary space-y-4 border-t pt-8">
          <div className="text-muted-foreground flex items-center gap-2 text-sm font-medium tracking-wider uppercase">
            <Timer className="h-4 w-4" />
            <span>{"Time Savings"}</span>
          </div>
          <div>
            <h3 className="mb-10 text-2xl">
              {
                "Discover a game-changing platform that boosts your productivity. Over 500 agents are currently in development and will be deployed soon."
              }
            </h3>
            <div className="flex items-start gap-2">
              <span className="text-7xl font-light">{"500"}</span>
              <span className="text-muted-foreground pt-2">
                {"% more free time"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
