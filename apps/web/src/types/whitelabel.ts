export interface WhitelabelConfig {
  name: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  customDomain: string;
  logo: string;
  /** Tema visual del panel del cliente (nimbus | onyx | terra). */
  theme: string;
  /** Secciones del panel ocultas para el cliente de la agencia. */
  hiddenSections: string[];
}
