import { createRoot } from "react-dom/client";
import App from "../../src/App";
import "../../src/styles.css";
createRoot(document.getElementById("root")!).render(<App user={{ id: "user", email: "test@example.com", firstName: "Test" }} />);
