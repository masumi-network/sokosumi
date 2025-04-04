import Link from "next/link";
import { FC } from "react";

import { Routes } from "@/types/routes";

interface TypedLinkProps {
  route: Routes;
  children: React.ReactNode;
}

const TypedLink: FC<TypedLinkProps> = ({ route, children }) => {
  return (
    <Link href={{ pathname: route.pathname, query: route.query }}>
      {children}
    </Link>
  );
};

export default TypedLink;
