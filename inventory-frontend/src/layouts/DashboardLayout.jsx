import React from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Navbar from "../components/Navbar";
import FloatingAiWidget from "../components/ai/FloatingAiWidget";

const DashboardLayout = () => {
    return (
        <div className="erp-layout">
            <Sidebar />
            <div className="erp-main-container">
                <Navbar />
                <main className="erp-content">
                    <Outlet />
                </main>
            </div>
            <FloatingAiWidget />
        </div>
    );
};

export default DashboardLayout;
