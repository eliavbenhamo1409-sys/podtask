import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

const nav = createNavigation(routing);

export const Link = nav.Link;
export const redirect = nav.redirect;
export const usePathname = nav.usePathname;
export const useRouter = nav.useRouter;
export const getPathname = nav.getPathname;
