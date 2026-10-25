import { RULES } from "./rules";

export const PLANS = [
  {
    id: "free",
    name: "Free",
    price: 0,
    credits: null,
    tagline: "Short ads unlock each job.",
    features: [
      `${RULES.image.anonLifetime} images without signing up`,
      `${RULES.image.loggedInPerDay} images a day with Google`,
      `1 video a day · ${RULES.video.freeSeconds}s · ${RULES.video.freeRes}p`,
      "Stickers, ID photos, thumbnails included",
    ],
    cta: "Start free",
  },
  {
    id: "starter",
    name: "Starter",
    price: 49,
    credits: 30,
    tagline: "For the occasional cutout.",
    features: ["30 credits", "No ads", "Image generation", "Video up to 1080p"],
    cta: "Buy with UPI",
  },
  {
    id: "creator",
    name: "Creator",
    price: 99,
    credits: 70,
    tagline: "For regular creators and sellers.",
    features: ["70 credits", "No ads", "WebM with transparency", "Everything in Starter"],
    cta: "Buy with UPI",
    popular: true,
  },
  {
    id: "pro",
    name: "Pro",
    price: 199,
    credits: 160,
    tagline: "For heavier video work.",
    features: ["160 credits", "No ads", "Everything in Creator", "Best value per credit"],
    cta: "Buy with UPI",
  },
] as const;
