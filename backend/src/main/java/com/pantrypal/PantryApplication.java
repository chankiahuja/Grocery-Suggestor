package com.pantrypal;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class PantryApplication {
    public static void main(String[] args) {
        var application = new SpringApplication(PantryApplication.class);
        if (isRecoveryReconciliation(args)) {
            application.setWebApplicationType(WebApplicationType.NONE);
            application.setAdditionalProfiles("recovery");
            application.setDefaultProperties(java.util.Map.of("spring.flyway.enabled", "false"));
            application.addInitializers(new RecoveryFlywayGuard());
            application.addInitializers(new RecoveryDatasourceGuard());
            application.addInitializers(new RecoveryWebApplicationTypeGuard());
        }
        application.run(args);
    }

    private static boolean isRecoveryReconciliation(String[] args) {
        for (String arg : args) if ("--recovery.reconcile=true".equalsIgnoreCase(arg)) return true;
        return false;
    }
}
