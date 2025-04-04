import { useRouter as useNextRouter } from "next/router";

import { Routes } from "@/types/routes";

export const useTypedRouter = () => {
  const router = useNextRouter();

  const push = (route: Routes) => {
    router.push({
      pathname: route.pathname,
      query: route.query,
    });
  };

  const replace = (route: Routes) => {
    router.replace({
      pathname: route.pathname,
      query: route.query,
    });
  };

  return {
    ...router,
    push,
    replace,
  };
};
