"use client";

import { useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Eyebrow } from "@/components/podtask/eyebrow";

interface WelcomeHeaderProps {
  studentName: string;
}

type DayPart = "Morning" | "Noon" | "Evening" | "Night";

const subscribeNoop = () => () => {};

function dayPartFor(hour: number): DayPart {
  if (hour < 5) return "Night";
  if (hour < 12) return "Morning";
  if (hour < 17) return "Noon";
  if (hour < 22) return "Evening";
  return "Night";
}

export function WelcomeHeader({ studentName }: WelcomeHeaderProps) {
  const t = useTranslations();
  // The server has no idea what time it is for the visitor, so it renders
  // the neutral greeting and the client swaps in the time-of-day one.
  const dayPart = useSyncExternalStore(
    subscribeNoop,
    () => dayPartFor(new Date().getHours()),
    () => null,
  );
  const eyebrow = dayPart
    ? `${t(`dashboard.greeting${dayPart}`)} · ${t("status.welcomeBack")}`
    : t("status.welcomeBack");

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={eyebrow}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Eyebrow showDot>{eyebrow}</Eyebrow>
        </motion.div>
      </AnimatePresence>
      <h1 className="display">
        {t("dashboard.greeting", { name: studentName })}
        <br />
        {t("dashboard.greetingLine2")}
      </h1>
      <p className="subtitle" style={{ maxWidth: 580 }}>
        {t("dashboard.subtitle")}
      </p>
    </motion.div>
  );
}
