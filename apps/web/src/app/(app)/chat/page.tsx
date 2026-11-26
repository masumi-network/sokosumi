import type { Metadata } from "next";
import WelcomePage, {
  generateMetadata as homeMetadata,
} from "../(welcome)/home-page";

export async function generateMetadata(): Promise<Metadata> {
  return homeMetadata();
}

export default WelcomePage;
