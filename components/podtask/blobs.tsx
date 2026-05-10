interface BlobsProps {
  variant?: "default" | "studio";
}

export function Blobs({ variant = "default" }: BlobsProps) {
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 0,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 520,
          height: 520,
          borderRadius: "50%",
          top: -120,
          insetInlineEnd: -120,
          background:
            "radial-gradient(circle, rgba(125,211,252,0.32), transparent 70%)",
          filter: "blur(20px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 480,
          height: 480,
          borderRadius: "50%",
          bottom: -160,
          insetInlineStart: -100,
          background:
            "radial-gradient(circle, rgba(253,164,175,0.28), transparent 70%)",
          filter: "blur(20px)",
        }}
      />
      {variant === "studio" && (
        <div
          style={{
            position: "absolute",
            width: 600,
            height: 600,
            borderRadius: "50%",
            top: "40%",
            insetInlineStart: "45%",
            transform: "translate(-50%,-50%)",
            background:
              "radial-gradient(circle, rgba(186,230,253,0.25), transparent 70%)",
            filter: "blur(30px)",
          }}
        />
      )}
    </div>
  );
}
