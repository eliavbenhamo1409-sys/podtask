"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Eyebrow } from "@/components/podtask/eyebrow";

interface WelcomeHeaderProps {
  studentName: string;
}

export function WelcomeHeader({ studentName }: WelcomeHeaderProps) {
  const t = useTranslations();

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <Eyebrow showDot>{t("status.welcomeBack")}</Eyebrow>
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
