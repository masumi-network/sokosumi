import dynamic from "next/dynamic";

const DynamicAblyProvider = dynamic(() => import("./ably-provider"), {
  ssr: false,
});

export default DynamicAblyProvider;
