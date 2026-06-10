import { env } from "../../env";
import { APP_NAME } from "../../config/app";

const sizeClasses = {
  login: "h-auto max-h-20 w-auto max-w-full sm:max-h-[84px]",
  header:
    "h-auto max-h-8 w-auto max-w-[3rem] sm:max-h-10 sm:max-w-none md:max-h-11 lg:max-h-12",
  sidebar: "h-auto max-h-10 w-auto max-w-full",
  drawer: "h-auto max-h-8 w-auto max-w-[7.5rem]",
} as const;

type CompanyLogoProps = {
  variant: keyof typeof sizeClasses;
  className?: string;
};

export function CompanyLogo({ variant, className = "" }: CompanyLogoProps) {
  return (
    <img
      src={env.logoUrl || "/logo.png"}
      alt={`${APP_NAME} logo`}
      className={`shrink-0 object-contain ${sizeClasses[variant]} ${className}`.trim()}
      draggable={false}
      loading="eager"
    />
  );
}
