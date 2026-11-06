import "./globals.css";
import type { Metadata } from "next";
export const metadata:Metadata={title:"MOVA | Movimento em informação",description:"Tecnologia acessível para análise experimental da marcha."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body>{children}</body></html>}
