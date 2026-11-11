package com.pantrypal;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.WebApplicationContextRunner;
import static org.assertj.core.api.Assertions.assertThat;

class PreLaunchAccessGateConfigurationContextTest {
    private final WebApplicationContextRunner contextRunner = new WebApplicationContextRunner()
        .withUserConfiguration(PreLaunchAccessGateConfiguration.class);

    @Test
    void missingUsernameFailsContextStartup() {
        contextRunner.withPropertyValues(
            "pantrypal.prelaunch-gate.enabled=true",
            "pantrypal.prelaunch-gate.password=Correct-Horse-Battery-2026!")
            .run(context -> assertThat(context).hasFailed());
    }

    @Test
    void missingOrWeakPasswordFailsContextStartup() {
        contextRunner.withPropertyValues(
            "pantrypal.prelaunch-gate.enabled=true",
            "pantrypal.prelaunch-gate.username=validation-operator")
            .run(context -> assertThat(context).hasFailed());
        contextRunner.withPropertyValues(
            "pantrypal.prelaunch-gate.enabled=true",
            "pantrypal.prelaunch-gate.username=validation-operator",
            "pantrypal.prelaunch-gate.password=short")
            .run(context -> assertThat(context).hasFailed());
    }

    @Test
    void colonContainingUsernameFailsContextStartup() {
        contextRunner.withPropertyValues(
            "pantrypal.prelaunch-gate.enabled=true",
            "pantrypal.prelaunch-gate.username=ops:validation",
            "pantrypal.prelaunch-gate.password=Correct-Horse-Battery-2026!")
            .run(context -> assertThat(context).hasFailed());
    }

    @Test
    void validDeploymentPropertiesCreateTheGate() {
        contextRunner.withPropertyValues(
            "pantrypal.prelaunch-gate.enabled=true",
            "pantrypal.prelaunch-gate.username=validation-operator",
            "pantrypal.prelaunch-gate.password=Correct-Horse-Battery-2026!")
            .run(context -> assertThat(context)
                .hasNotFailed()
                .hasSingleBean(PreLaunchAccessGateFilter.class));
    }
}
